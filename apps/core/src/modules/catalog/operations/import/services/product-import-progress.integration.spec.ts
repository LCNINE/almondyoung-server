import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { catalogSchema, type PimSchema } from '../../../schema/catalog.schema';
import { ProductImportSessionReader } from './product-import-session.reader';
import { ProductImportProgressBuilder } from './product-import-progress.builder';
import type { OptionReadLoader } from '../../../core/products/loaders/option-read.loader';

/**
 * 진행률 집계를 **진짜 Postgres** 에 대고 구동한다.
 *
 * 목 하네스는 `.groupBy()` 를 삼켜도 같은 배열을 돌려주므로 GROUP BY 가 SQL 에
 * 실리지 않아도 초록이고, `count()` 가 bigint 문자열로 올라오는 것도 보이지 않는다.
 * 여기서는 실제 SQL 이 실제 행에 어떻게 작용하는지만 본다.
 *
 * **격리**: 일회용 스키마를 만들고 커넥션의 search_path 를 거기로 돌린다
 * (선례: product-import-job-lease.integration.spec.ts:31-38).
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_PRODUCT_IMPORT_PROGRESS_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the product import progress integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('product import 진행률 집계 (DB 통합)', () => {
  jest.setTimeout(120_000);

  const schemaName = `pi_progress_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql;
  let client: postgres.Sql;
  let reader: ProductImportSessionReader;
  const builder = new ProductImportProgressBuilder();

  beforeAll(async () => {
    const bootstrap = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await bootstrap.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await bootstrap.end();

    admin = postgres(DATABASE_URL as string, { max: 1, prepare: false, connection: { search_path: schemaName } });
    // public 의 실제 DDL 을 복제한다 — 손으로 옮겨 적은 테이블에 대고 통과하는
    // 테스트는 아무 것도 증명하지 못한다.
    await admin.unsafe(`CREATE TABLE product_import_sessions (LIKE public.product_import_sessions INCLUDING ALL)`);
    await admin.unsafe(`CREATE TABLE product_import_items (LIKE public.product_import_items INCLUDING ALL)`);

    client = postgres(DATABASE_URL as string, { max: 1, prepare: false, connection: { search_path: schemaName } });
    const db = drizzle(client, { schema: catalogSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: never) => Promise<T>, tx?: never): Promise<T> =>
        tx ? fn(tx) : db.transaction((t) => fn(t as never)),
    } as unknown as DbService<PimSchema>;
    // 진행률 경로는 옵션 조합을 읽지 않는다 — OptionReadLoader 는 한 번도 호출되지 않는다.
    reader = new ProductImportSessionReader(dbService, undefined as unknown as OptionReadLoader);
  });

  afterAll(async () => {
    await admin?.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await Promise.all([client?.end(), admin?.end()]);
  });

  beforeEach(async () => {
    await admin`DELETE FROM product_import_sessions`;
  });

  async function seedSession(totalRows: number, invalidCount: number | null): Promise<string> {
    const id = randomUUID();
    await admin`
      INSERT INTO product_import_sessions
             (id, file_name, total_rows, invalid_count, status, commit_status, publish_status)
      VALUES (${id}, ${'it-progress-' + id}, ${totalRows}, ${invalidCount},
              'completed', 'completed', 'running')
    `;
    return id;
  }

  /**
   * enum 값을 **SQL 리터럴**로 적는다. 일회용 스키마의 search_path 에 public 이 없어
   * `::product_import_item_status` 캐스트는 해석되지 않고, 리터럴로 두면 Postgres 가
   * 컬럼 타입으로 알아서 강제한다. 값이 전부 이 스펙이 만든 상수라 unsafe 로 충분하다.
   */
  async function seedItems(
    sessionId: string,
    rows: Array<{ status: string; publishStatus: string; count: number }>,
  ): Promise<void> {
    const values: string[] = [];
    let rowNumber = 1;
    for (const row of rows) {
      for (let i = 0; i < row.count; i += 1) {
        values.push(
          `('${randomUUID()}', '${sessionId}', ${rowNumber}, 'P${rowNumber}', '${row.status}', '${row.publishStatus}')`,
        );
        rowNumber += 1;
      }
    }
    if (values.length === 0) return;
    await admin.unsafe(
      `INSERT INTO product_import_items (id, session_id, row_number, product_key, status, publish_status)
       VALUES ${values.join(', ')}`,
    );
  }

  it('조합별 집계가 실제 행 분포와 일치하고, count 가 숫자로 돌아온다', async () => {
    const sessionId = await seedSession(10, 2);
    await seedItems(sessionId, [
      { status: 'failed', publishStatus: 'skipped', count: 2 }, // 접수 시점 검증실패
      { status: 'failed', publishStatus: 'skipped', count: 1 }, // 생성 실패
      { status: 'created', publishStatus: 'published', count: 4 },
      { status: 'created', publishStatus: 'failed', count: 1 },
      { status: 'created', publishStatus: 'pending', count: 2 },
    ]);

    const { session, itemCounts } = await reader.getProgressCounts(sessionId);

    // GROUP BY 가 SQL 에 실리지 않았다면 행 10개가 그대로 올라온다.
    expect(itemCounts).toHaveLength(4);
    for (const row of itemCounts) {
      expect(typeof row.count).toBe('number');
    }

    const progress = builder.build(session, itemCounts);
    // 검증실패 2 는 commit 분모에서 빠지고, 남은 failed 1 이 생성 실패다.
    expect(progress.stages.find((s) => s.key === 'commit')).toMatchObject({ total: 8, done: 8, failed: 1 });
    // 게시 분모는 생성 7행. published 4 + failed 1 = 5 처리됨.
    expect(progress.stages.find((s) => s.key === 'publish')).toMatchObject({ total: 7, done: 5, failed: 1 });
  });

  it('다른 세션의 행을 섞어 세지 않는다', async () => {
    const mine = await seedSession(2, 0);
    const theirs = await seedSession(3, 0);
    await seedItems(mine, [{ status: 'created', publishStatus: 'pending', count: 2 }]);
    await seedItems(theirs, [{ status: 'failed', publishStatus: 'skipped', count: 3 }]);

    const { session, itemCounts } = await reader.getProgressCounts(mine);
    const progress = builder.build(session, itemCounts);

    expect(itemCounts).toEqual([{ status: 'created', publishStatus: 'pending', count: 2 }]);
    // 남의 세션 실패 3행이 섞였다면 total 이 5, failed 가 3 이 된다.
    expect(progress.stages.find((s) => s.key === 'commit')).toMatchObject({ total: 2, done: 2, failed: 0 });
  });

  it('행이 하나도 없어도 죽지 않고 분모 0 을 돌려준다', async () => {
    const sessionId = await seedSession(0, 0);

    const { session, itemCounts } = await reader.getProgressCounts(sessionId);
    const progress = builder.build(session, itemCounts);

    expect(itemCounts).toEqual([]);
    expect(progress.stages.every((s) => s.total === 0 && s.done === 0)).toBe(true);
  });

  it('invalid_count 가 null 인 옛 세션도 그대로 읽힌다', async () => {
    const sessionId = await seedSession(3, null);
    await seedItems(sessionId, [
      { status: 'failed', publishStatus: 'skipped', count: 1 },
      { status: 'created', publishStatus: 'published', count: 2 },
    ]);

    const { session, itemCounts } = await reader.getProgressCounts(sessionId);
    const progress = builder.build(session, itemCounts);

    expect(progress.invalidCount).toBeNull();
    expect(progress.stages.find((s) => s.key === 'commit')).toMatchObject({ total: 3, done: 3, failed: 1 });
  });

  it('없는 세션은 NotFoundError', async () => {
    await expect(reader.getProgressCounts(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});
