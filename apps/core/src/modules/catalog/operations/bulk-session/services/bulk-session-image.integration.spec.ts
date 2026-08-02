import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import {
  catalogSchema,
  type PimSchema,
  productBulkImages,
  productBulkItems,
  productBulkSessions,
} from '../../../schema/catalog.schema';
import { BulkSessionReader } from './bulk-session.reader';
import { BulkImageManager } from './bulk-image.manager';
import { BulkImageCleaner, IMAGE_CLEANUP_BATCH } from './bulk-image.cleaner';

/**
 * 3단계 이미지 경로를 **진짜 Postgres** 에 대고 구동한다.
 *
 * 페이크 DB 로 증명되지 않는 두 가지를 본다: (1) 스윕의 `notExists`/`eq` 술어가 실제로
 * 대상을 걸러내는가, (2) 전량 게이트 전진 CAS 가 동시 통보에서 한 번만 이기는가.
 *
 * **강제 커버 목록(Task 8 리뷰)**: `bulk-image.cleaner.spec.ts` 의 하네스는 대상 선택
 * `where()` 인자를 통째로 버린다(파일 상단 주석 참고) — 그래서 그 술어의 4 조건과
 * 후처리 UPDATE 의 행 특정 조건, 그리고 `orderBy`+`limit` 이 실제로 SQL 에 걸리는지는
 * 이 스위트가 실 Postgres 로 못 박아야 한다. 아래 표는 각 테스트가 어느 조건을 덮는지다:
 *
 *   (a) eq(sourceKind, 'file_name')      → '양식에 파일ID로 적힌 이미지 …'
 *   (b) notExists(draft_version_id 아이템) → 'draft 가 하나라도 붙은 취소 세션 …'
 *   (c) eq(phase, 'canceled')             → '진행 중 세션의 이미지는 스윕 대상이 아니다'
 *   (d) orderBy(updatedAt) + limit(...)   → '배치 상한을 넘는 대상 중 …'
 *   (e) .where(eq(images.id, target.id))  → '대상 아닌 이미지가 같은 스윕에 섞여 있어도 …'
 *
 * **실행**: 전용 scratch DB(`bulk_stage3_scratch`)에 core 마이그레이션을 올린 뒤 그 DB 를
 * 가리키는 DATABASE_URL 로 돌린다 — `dev_core` 에는 이 브랜치와 무관한 보류 마이그레이션이
 * 있어 거기서 마이그레이션을 실행하면 안 된다.
 *
 * **격리**: 일회용 스키마를 만들고 커넥션의 search_path 를 startup 파라미터로 고정한다
 * (`SET search_path` 는 postgres.js 가 물리 재연결하면 조용히 public 으로 되돌아간다).
 * 스윕의 대상 쿼리에는 세션을 골라내는 필터가 없어(취소된 세션 전부가 대상이다) public
 * 스키마에 붙으면 남의 세션 이미지를 지운다. 선례: bulk-session-lease.integration.spec.ts:26-32.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_BULK_SESSION_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the bulk session image integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function connect(url: string, schema: string): postgres.Sql {
  return postgres(url, { max: 1, prepare: false, connection: { search_path: schema } });
}

/**
 * `DbService` 를 구조적으로 흉내 낸다 — 실제 클래스를 생성하지 않는 것이
 * `bulk-session-lease.integration.spec.ts:96-102` 가 세운 선례다(`run` 만 쓰면 되고,
 * 생성자 의존성을 통째로 끌고 오면 이 스위트가 무거워진다).
 */
function makeDbService(client: postgres.Sql): DbService<PimSchema> {
  const db = drizzle(client, { schema: catalogSchema });
  return {
    db,
    run: <T>(fn: (t: never) => Promise<T>, tx?: never): Promise<T> =>
      tx ? fn(tx) : db.transaction((t) => fn(t as never)),
  } as unknown as DbService<PimSchema>;
}

describeIfDb('일괄 세션 이미지 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const schemaName = `bs_img_${randomUUID().replaceAll('-', '')}`;
  let sql: postgres.Sql;
  let db: DbService<PimSchema>;
  let reader: BulkSessionReader;
  /**
   * "동시 통보" 테스트 전용 커넥션 둘. `max:1` 커넥션 하나로 `Promise.all` 을 돌리면
   * postgres.js 가 모든 쿼리를 한 물리 커넥션에 직렬화해 두 트랜잭션이 인터리브되지
   * 않는다 — "CAS 가 올바르게 이겼다"와 "CAS 가 아예 없어서 순차로 그냥 착지했다"를
   * 구분 못 한다(Task 8 리뷰 Important #1). `bulk-session-lease.integration.spec.ts:149-152`
   * 의 clientA/clientB 선례를 그대로 따라 물리 커넥션을 둘로 나눈다.
   */
  let clientA: postgres.Sql;
  let clientB: postgres.Sql;

  /**
   * file-service 스텁. 통보된 fileId 는 전부 유효한 product-image 로 답한다.
   *
   * **이 스텁은 토큰/권한을 흉내 내지 않는다** — 이미지 경로가 master 없는 위임 토큰을
   * 쓴다는 보안 경계는 `form-export-file.client.spec.ts` 가 토큰 클레임으로 고정하고,
   * 여기서는 `softDeleteOwnedFile` 이라는 **메서드 선택**만 고정한다(워크북용
   * `softDelete` 를 일부러 두지 않아 회귀가 TypeError 로 드러난다).
   */
  const softDeleted: string[] = [];
  const fileClient = {
    getMetadata: (fileId: string) =>
      Promise.resolve({ id: fileId, contextId: 'product-image', status: 'active', originalName: 'x.jpg' }),
    softDeleteOwnedFile: (fileId: string) => {
      softDeleted.push(fileId);
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    // 스키마 생성은 search_path 가 아직 없는 부트스트랩 커넥션으로 한다 — 존재하지 않는
    // 스키마를 search_path 로 들고 접속하는 것을 피한다(lease 스펙 :137-140 과 같은 순서).
    const bootstrap = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await bootstrap.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await bootstrap.end();

    sql = connect(DATABASE_URL as string, schemaName);
    // public 의 실제 DDL 을 그대로 복제한다 — 손으로 옮겨 적으면 스키마가 갈라진다.
    // (enum 컬럼 타입은 public 의 타입 OID 로 해석돼 따라온다. LIKE 는 외래키를 복제하지
    // 않는다 — 이 스위트는 FK 를 검증 대상으로 삼지 않으므로 상품/양식 테이블이 없어도 된다.)
    await sql.unsafe(`CREATE TABLE product_bulk_sessions (LIKE public.product_bulk_sessions INCLUDING ALL)`);
    await sql.unsafe(`CREATE TABLE product_bulk_items (LIKE public.product_bulk_items INCLUDING ALL)`);
    await sql.unsafe(`CREATE TABLE product_bulk_images (LIKE public.product_bulk_images INCLUDING ALL)`);

    db = makeDbService(sql);
    reader = new BulkSessionReader(db as never);

    // 같은 일회용 스키마로 search_path 를 고정한 별도 물리 커넥션 — 위 클래스 코멘트 참고.
    clientA = connect(DATABASE_URL as string, schemaName);
    clientB = connect(DATABASE_URL as string, schemaName);
  });

  afterAll(async () => {
    // 격리가 진짜 성립했다는 실측 — 이 스위트의 어떤 INSERT 도 public 에 닿지 않았어야
    // 한다. 스윕의 대상 쿼리에는 세션을 골라내는 필터가 없어(취소된 세션 전부가 대상이다)
    // 격리가 깨지면 개발자의 public 세션을 스윕이 지운다 — 그 사고가 여기서 먼저 터지게
    // 한다(선례: bulk-session-lease.integration.spec.ts:155-166). `sql` 은 search_path 가
    // 임시 스키마로 고정돼 있지만 `public.` 스키마 한정은 그 설정을 무시하고 항상 진짜
    // public 을 가리킨다.
    const [{ count }] = (await sql`SELECT count(*)::int AS count FROM public.product_bulk_sessions`) as unknown as [
      { count: number },
    ];
    expect(count).toBe(0);

    await Promise.all([sql?.end({ timeout: 5 }), clientA?.end({ timeout: 5 }), clientB?.end({ timeout: 5 })]);
    const cleanup = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await cleanup.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await cleanup.end();
  });

  beforeEach(async () => {
    softDeleted.length = 0;
    // search_path 가 임시 스키마로 고정돼 있어 이름만으로 그 스키마의 테이블을 가리킨다.
    await sql.unsafe(`TRUNCATE product_bulk_images, product_bulk_items, product_bulk_sessions`);
  });

  /**
   * `phase` 를 이 스펙이 실제로 쓰는 값만 리터럴 유니언으로 좁힌다 — `string` 이었다면
   * enum 컬럼에 넣기 위해 `as never` 캐스팅이 필요했는데, 그건 이 태스크가 허용하는
   * "페이크·스텁 주입의 `as never`" 범위 밖이다(Task 8 리뷰 Important #2). 다른 phase 값이
   * 필요해지면 그때 유니언에 추가한다.
   */
  async function seedSession(phase: 'awaiting_images' | 'canceled', userId = randomUUID()): Promise<string> {
    const [row] = await db.run((trx) =>
      trx
        .insert(productBulkSessions)
        .values({
          name: 's',
          uploadedBy: userId,
          fileName: 'f.xlsx',
          sourceFileId: randomUUID(),
          phase,
          totalRows: 1,
        })
        .returning({ id: productBulkSessions.id, uploadedBy: productBulkSessions.uploadedBy }),
    );
    return row.id;
  }

  it('요구된 마지막 파일이 채워지면 phase 가 drafting 으로 전진한다', async () => {
    const userId = randomUUID();
    const sessionId = await seedSession('awaiting_images', userId);
    await db.run((trx) =>
      trx.insert(productBulkItems).values({
        sessionId,
        rowNumber: 1,
        rowKey: 'P1',
        kind: 'create',
        input: {},
        payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] },
        status: 'pending',
      }),
    );
    await db.run((trx) =>
      trx.insert(productBulkImages).values([
        {
          sessionId,
          imageKey: 'IMG-1',
          usage: 'main',
          sourceKind: 'file_name',
          sourceValue: 'a.jpg',
          status: 'awaiting_upload',
        },
        // 아무도 참조하지 않는 미해결 행 — 게이트가 이걸 세면 안 된다.
        {
          sessionId,
          imageKey: 'IMG-9',
          usage: 'main',
          sourceKind: 'file_name',
          sourceValue: 'ghost.jpg',
          status: 'awaiting_upload',
        },
      ]),
    );

    const manager = new BulkImageManager(db as never, fileClient as never, reader);
    const out = await manager.resolve(sessionId, userId, [{ imageKey: 'IMG-1', usage: 'main', fileId: randomUUID() }]);

    expect(out.results[0].ok).toBe(true);
    expect(out.progress.phase).toBe('drafting');
  });

  it('동시 통보에서 전진 CAS 는 한 번만 이기고 둘 다 성공 응답을 받는다', async () => {
    const userId = randomUUID();
    const sessionId = await seedSession('awaiting_images', userId);
    await db.run((trx) =>
      trx.insert(productBulkItems).values({
        sessionId,
        rowNumber: 1,
        rowKey: 'P1',
        kind: 'create',
        input: {},
        payload: {
          fields: {},
          imageRefs: [
            { imageKey: 'IMG-1', usage: 'main' },
            { imageKey: 'IMG-2', usage: 'main' },
          ],
        },
        status: 'pending',
      }),
    );
    await db.run((trx) =>
      trx.insert(productBulkImages).values([
        {
          sessionId,
          imageKey: 'IMG-1',
          usage: 'main',
          sourceKind: 'file_name',
          sourceValue: 'a.jpg',
          status: 'awaiting_upload',
        },
        {
          sessionId,
          imageKey: 'IMG-2',
          usage: 'main',
          sourceKind: 'file_name',
          sourceValue: 'b.jpg',
          status: 'awaiting_upload',
        },
      ]),
    );

    // 서로 다른 물리 커넥션 위의 매니저 둘 — 같은 커넥션이었다면 postgres.js 가
    // 쿼리를 직렬화해 두 트랜잭션이 인터리브되지 않는다(위 clientA/clientB 코멘트 참고).
    const dbA = makeDbService(clientA);
    const dbB = makeDbService(clientB);
    const managerA = new BulkImageManager(dbA as never, fileClient as never, new BulkSessionReader(dbA as never));
    const managerB = new BulkImageManager(dbB as never, fileClient as never, new BulkSessionReader(dbB as never));
    const [first, second] = await Promise.all([
      managerA.resolve(sessionId, userId, [{ imageKey: 'IMG-1', usage: 'main', fileId: randomUUID() }]),
      managerB.resolve(sessionId, userId, [{ imageKey: 'IMG-2', usage: 'main', fileId: randomUUID() }]),
    ]);

    expect(first.results[0].ok).toBe(true);
    expect(second.results[0].ok).toBe(true);
    const [session] = await db.run((trx) =>
      trx
        .select({ phase: productBulkSessions.phase })
        .from(productBulkSessions)
        .where(eq(productBulkSessions.id, sessionId)),
    );
    expect(session.phase).toBe('drafting');
  });

  it('취소된 세션이 올린 파일을 스윕이 지우고 행을 되돌린다', async () => {
    const sessionId = await seedSession('canceled');
    const fileId = randomUUID();
    await db.run((trx) =>
      trx.insert(productBulkImages).values({
        sessionId,
        imageKey: 'IMG-1',
        usage: 'main',
        sourceKind: 'file_name',
        sourceValue: 'a.jpg',
        status: 'resolved',
        fileId,
      }),
    );

    const cleaner = new BulkImageCleaner(db as never, fileClient as never, { get: () => undefined } as never);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(softDeleted).toEqual([fileId]);

    const [row] = await db.run((trx) => trx.select().from(productBulkImages));
    expect(row.fileId).toBeNull();
    expect(row.status).toBe('awaiting_upload');

    // 멱등: 두 번째 스윕은 아무 것도 하지 않는다.
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 0, failed: 0 });
  });

  // 강제 커버 (a): eq(productBulkImages.sourceKind, 'file_name') 이 지워지면 이 행(file_id)이
  // 대상에 섞여 들어와 살아있는 상품 이미지가 지워진다.
  it('양식에 파일ID로 적힌 이미지(sourceKind=file_id)는 스윕이 건드리지 않는다', async () => {
    const sessionId = await seedSession('canceled');
    await db.run((trx) =>
      trx.insert(productBulkImages).values({
        sessionId,
        imageKey: 'IMG-1',
        usage: 'main',
        sourceKind: 'file_id',
        sourceValue: randomUUID(),
        status: 'resolved',
        fileId: randomUUID(),
      }),
    );
    const cleaner = new BulkImageCleaner(db as never, fileClient as never, { get: () => undefined } as never);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 0, failed: 0 });
    expect(softDeleted).toEqual([]);
  });

  // 강제 커버 (b): notExists(draft_version_id 있는 아이템) 이 지워지면 4단계가 오는 순간
  // draft 가 참조 중인 파일을 스윕이 지운다. 3단계에는 4단계 워커가 없어 실제로는 아직
  // 도달 불가능한 상태지만, 미리 막아 둔다.
  it('draft 가 하나라도 붙은 취소 세션은 스윕이 건드리지 않는다', async () => {
    const sessionId = await seedSession('canceled');
    await db.run((trx) =>
      trx.insert(productBulkItems).values({
        sessionId,
        rowNumber: 1,
        rowKey: 'P1',
        kind: 'create',
        input: {},
        status: 'drafted',
        draftVersionId: randomUUID(),
      }),
    );
    await db.run((trx) =>
      trx.insert(productBulkImages).values({
        sessionId,
        imageKey: 'IMG-1',
        usage: 'main',
        sourceKind: 'file_name',
        sourceValue: 'a.jpg',
        status: 'resolved',
        fileId: randomUUID(),
      }),
    );
    const cleaner = new BulkImageCleaner(db as never, fileClient as never, { get: () => undefined } as never);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 0, failed: 0 });
    expect(softDeleted).toEqual([]);
  });

  // 강제 커버 (c): eq(productBulkSessions.phase, 'canceled') 이 지워지면 진행 중 세션의
  // 이미지도 대상에 섞인다.
  it('진행 중 세션의 이미지는 스윕 대상이 아니다', async () => {
    const sessionId = await seedSession('awaiting_images');
    await db.run((trx) =>
      trx.insert(productBulkImages).values({
        sessionId,
        imageKey: 'IMG-1',
        usage: 'main',
        sourceKind: 'file_name',
        sourceValue: 'a.jpg',
        status: 'resolved',
        fileId: randomUUID(),
      }),
    );
    const cleaner = new BulkImageCleaner(db as never, fileClient as never, { get: () => undefined } as never);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 0, failed: 0 });
  });

  // 강제 커버 (e): 후처리 UPDATE 의 `.where(eq(productBulkImages.id, target.id))` 가 지워지면
  // WHERE 없는 UPDATE 가 테이블 전체 행에 적용된다. 대상(A, file_name)과 대상이 아닌 행(B,
  // file_id — 애초에 SELECT 대상에서 걸러진다)을 같은 스윕에 두어, A 처리 중 실행되는
  // UPDATE 가 B 까지 건드리지 않는지 본다.
  it('대상 아닌 이미지가 같은 스윕에 섞여 있어도 대상 행만 바뀐다', async () => {
    const sessionId = await seedSession('canceled');
    const targetFileId = randomUUID();
    const untouchedFileId = randomUUID();
    await db.run((trx) =>
      trx.insert(productBulkImages).values([
        {
          sessionId,
          imageKey: 'IMG-TARGET',
          usage: 'main',
          sourceKind: 'file_name',
          sourceValue: 'a.jpg',
          status: 'resolved',
          fileId: targetFileId,
        },
        {
          sessionId,
          imageKey: 'IMG-OTHER',
          usage: 'main',
          sourceKind: 'file_id',
          sourceValue: randomUUID(),
          status: 'resolved',
          fileId: untouchedFileId,
        },
      ]),
    );

    const cleaner = new BulkImageCleaner(db as never, fileClient as never, { get: () => undefined } as never);
    await expect(cleaner.sweepOnce()).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(softDeleted).toEqual([targetFileId]);

    const rows = await db.run((trx) =>
      trx
        .select({
          imageKey: productBulkImages.imageKey,
          fileId: productBulkImages.fileId,
          status: productBulkImages.status,
        })
        .from(productBulkImages)
        .orderBy(productBulkImages.imageKey),
    );
    const target = rows.find((r) => r.imageKey === 'IMG-TARGET');
    const other = rows.find((r) => r.imageKey === 'IMG-OTHER');
    expect(target?.fileId).toBeNull();
    expect(target?.status).toBe('awaiting_upload');
    // WHERE 절이 살아있어야만 이 행이 그대로 남는다.
    expect(other?.fileId).toBe(untouchedFileId);
    expect(other?.status).toBe('resolved');
  });

  // 강제 커버 (d): `.orderBy(productBulkImages.updatedAt)` + `.limit(IMAGE_CLEANUP_BATCH)` 가
  // 실제로 걸리는지. IMAGE_CLEANUP_BATCH+1 개의 대상 행을 심되, updatedAt 을 createdAt 과
  // 정반대 순서로 준다 — 두 컬럼 중 어느 쪽으로 정렬하느냐에 따라 "배치에서 밀려나는 행"이
  // 달라지게 만든다. 정답(코드가 실제로 하는 것)은 updatedAt 오름차순 + limit 이므로
  // updatedAt 이 가장 큰 행(=가장 최근에 갱신된 행, createdAt 은 가장 작다) 하나만 이번 틱
  // 배치에서 빠져야 한다.
  it('배치 상한을 넘는 대상 중 updatedAt 이 가장 최근인 행이 이번 틱에서 밀려난다', async () => {
    const sessionId = await seedSession('canceled');
    const total = IMAGE_CLEANUP_BATCH + 1;
    const base = new Date('2026-01-01T00:00:00Z').getTime();

    const rows = Array.from({ length: total }, (_, i) => ({
      sessionId,
      imageKey: `IMG-${String(i).padStart(4, '0')}`,
      usage: 'main' as const,
      sourceKind: 'file_name' as const,
      sourceValue: `f${i}.jpg`,
      status: 'resolved' as const,
      fileId: randomUUID(),
      // createdAt 은 i 에 비례해 커진다(오름차순). updatedAt 은 정확히 반대(내림차순) —
      // i=0 행이 createdAt 최소·updatedAt 최대, i=total-1 행이 그 반대다.
      createdAt: new Date(base + i * 1000),
      updatedAt: new Date(base + (total - 1 - i) * 1000),
    }));
    await db.run((trx) => trx.insert(productBulkImages).values(rows));

    const cleaner = new BulkImageCleaner(db as never, fileClient as never, { get: () => undefined } as never);
    const result = await cleaner.sweepOnce();
    expect(result.deleted).toBe(IMAGE_CLEANUP_BATCH);
    expect(result.failed).toBe(0);

    // i=0: createdAt 최소, updatedAt 최대 → updatedAt 오름차순 정렬이면 배치의 맨 끝이라
    // limit 에 걸려 이번 틱에서 제외돼야 한다(그대로 남아 있어야 한다).
    const skipped = await db.run((trx) =>
      trx
        .select({ fileId: productBulkImages.fileId })
        .from(productBulkImages)
        .where(eq(productBulkImages.imageKey, 'IMG-0000')),
    );
    expect(skipped[0]?.fileId).not.toBeNull();

    // i=total-1: createdAt 최대, updatedAt 최소 → updatedAt 오름차순 정렬이면 배치의
    // 맨 앞이라 반드시 처리됐어야 한다. orderBy 가 createdAt 으로 바뀌면 이 행이 바로 밀려나는
    // 쪽이 되어 이 단정이 깨진다.
    const processed = await db.run((trx) =>
      trx
        .select({ fileId: productBulkImages.fileId })
        .from(productBulkImages)
        .where(eq(productBulkImages.imageKey, `IMG-${String(total - 1).padStart(4, '0')}`)),
    );
    expect(processed[0]?.fileId).toBeNull();
  });
});
