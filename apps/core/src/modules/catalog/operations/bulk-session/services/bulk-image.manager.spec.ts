import { ConflictError, NotFoundError } from '@app/shared';
import { PgDialect } from 'drizzle-orm/pg-core';
import { BulkImageManager } from './bulk-image.manager';
import { BulkSessionReader } from './bulk-session.reader';
import { productBulkImages, productBulkItems, productBulkSessions } from '../../../schema/catalog.schema';

type FakeRow = Record<string, unknown>;

const dialect = new PgDialect();

/** drizzle 컬럼명(snake_case) → 픽스처 키(camelCase). */
function toCamelKey(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * `.where()` 에 넘어온 조건을 렌더해 행이 그 조건을 만족하는지 판정한다. 이 매니저가
 * 실제로 쓰는 연산자(`eq`·`and`·`isNull`)만 지원한다 — bulk-session.manager.spec.ts 가
 * 세운 기법을 필요한 만큼만 가져온다.
 */
function rowMatchesCondition(row: FakeRow, condition: unknown): boolean {
  if (condition === undefined) return true;
  const { sql, params } = dialect.sqlToQuery(condition as never);
  const lowered = sql.toLowerCase();
  let ok = true;
  for (const m of lowered.matchAll(/"(\w+)"\s*=\s*\$(\d+)/g)) {
    if (row[toCamelKey(m[1])] !== params[Number(m[2]) - 1]) ok = false;
  }
  for (const m of lowered.matchAll(/"(\w+)"\s+is\s+null/g)) {
    const value = row[toCamelKey(m[1])];
    if (!(value === null || value === undefined)) ok = false;
  }
  return ok;
}

interface Chain extends Promise<FakeRow[]> {
  where(condition?: unknown): Chain;
  orderBy(...args: unknown[]): Chain;
  groupBy(...args: unknown[]): Chain;
  limit(n?: number): Chain;
  offset(n?: number): Chain;
  for(mode?: unknown): Chain;
}

function chain(rows: FakeRow[], isCount = false): Chain {
  const builder = Promise.resolve(isCount ? [{ value: rows.length }] : rows) as Chain;
  builder.where = (condition) =>
    chain(
      rows.filter((row) => rowMatchesCondition(row, condition)),
      isCount,
    );
  builder.orderBy = () => builder;
  builder.groupBy = () => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(String(row.status), (counts.get(String(row.status)) ?? 0) + 1);
    return chain([...counts.entries()].map(([status, value]) => ({ status, value })));
  };
  builder.limit = () => builder;
  builder.offset = () => builder;
  // 페이크 DB 는 트랜잭션·행 잠금을 흉내 내지 않는다 — `BulkImageManager.resolve` ③ 단계가
  // 동시 요청을 직렬화하려고 세션 행에 거는 `SELECT ... FOR UPDATE` 를 통과만 시킨다.
  // 잠금이 실제로 경합을 막는지는 실 Postgres 로만 증명할 수 있다
  // (bulk-session-image.integration.spec.ts '동시 통보 …' 케이스).
  builder.for = () => builder;
  return builder;
}

interface Fixture {
  sessions: FakeRow[];
  items: FakeRow[];
  images: FakeRow[];
}

function harness(
  fixture: Fixture,
  metadata: Record<string, { contextId: string; status: string } | null> = {},
  // 리뷰 Important #1 — getMetadata 는 404 뿐 아니라 5xx·타임아웃에서도 던진다. 픽스처
  // 맵으로는 그 throw 를 표현할 수 없어 최소한만 확장한다: 여기 담긴 fileId 로 조회하면
  // 항상 reject 한다.
  throwingFileIds: string[] = [],
) {
  const tableRows = (table: unknown): FakeRow[] => {
    if (table === productBulkSessions) return fixture.sessions;
    if (table === productBulkItems) return fixture.items;
    if (table === productBulkImages) return fixture.images;
    throw new Error('알 수 없는 테이블');
  };

  const trx = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => chain(tableRows(table), isCountQuery(fields)),
    }),
    update: (table: unknown) => ({
      set: (values: FakeRow) => ({
        where: (condition?: unknown) => {
          const target = tableRows(table).filter((row) => rowMatchesCondition(row, condition));
          for (const row of target) Object.assign(row, values);
          return {
            returning: () => Promise.resolve(target.map((row) => ({ ...row }))),
            then: (resolve: (rows: FakeRow[]) => unknown) => resolve(target),
          };
        },
      }),
    }),
  };

  const softDeleted: string[] = [];
  const fileClient = {
    getMetadata: (fileId: string) => {
      if (throwingFileIds.includes(fileId)) {
        return Promise.reject(new Error('file-service 메타데이터 조회 실패 (502)'));
      }
      return Promise.resolve(metadata[fileId] ?? null);
    },
    // 이미지 정리는 반드시 master 없는 `softDeleteOwnedFile` 이어야 한다 — 워크북용
    // `softDelete`(master 스코프)로 되돌아가면 임의 파일 삭제 취약점이 되살아난다.
    // 페이크에 `softDelete` 를 두지 않는 것이 그 회귀를 TypeError 로 잡는 장치다.
    softDeleteOwnedFile: (fileId: string) => {
      softDeleted.push(fileId);
      return Promise.resolve();
    },
  };

  const db = { run: (fn: (t: unknown) => unknown) => fn(trx) };
  // 진짜 Reader 를 같은 페이크 DB 로 만든다 — 게이트 술어와 진행률이 실제로 도는지 봐야 한다
  // (bulk-session.manager.spec.ts:549-550 과 같은 이유).
  const reader = new BulkSessionReader(db as never);
  const manager = new BulkImageManager(db as never, fileClient as never, reader);
  return { manager, fileClient, softDeleted, fixture };
}

function isCountQuery(fields: unknown): boolean {
  if (typeof fields !== 'object' || fields === null) return false;
  const keys = Object.keys(fields);
  return keys.length === 1 && keys[0] === 'value';
}

const SESSION = '00000000-0000-7000-8000-000000000001';
const USER = '00000000-0000-7000-8000-000000000009';
const FILE = '00000000-0000-7000-8000-0000000000aa';

function baseFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    sessions: [
      {
        id: SESSION,
        uploadedBy: USER,
        phase: 'awaiting_images',
        cancelRequestedAt: null,
        totalRows: 1,
        phaseError: null,
      },
    ],
    items: [
      {
        sessionId: SESSION,
        status: 'pending',
        payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] },
      },
    ],
    images: [
      {
        id: 'img-row-1',
        sessionId: SESSION,
        imageKey: 'IMG-1',
        usage: 'main',
        sourceKind: 'file_name',
        sourceValue: 'front.jpg',
        status: 'awaiting_upload',
        fileId: null,
      },
    ],
    ...overrides,
  };
}

describe('BulkImageManager.resolve — 가드', () => {
  it('남의 세션이면 NotFoundError', async () => {
    const { manager } = harness(baseFixture(), { [FILE]: { contextId: 'product-image', status: 'active' } });
    await expect(
      manager.resolve(SESSION, 'someone-else', [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('awaiting_images 가 아니면 ConflictError', async () => {
    const fixture = baseFixture();
    fixture.sessions[0].phase = 'review';
    const { manager } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    await expect(
      manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('BulkImageManager.resolve — 항목 처리', () => {
  it('통과한 항목을 resolved 로 기록한다', async () => {
    const { manager, fixture } = harness(baseFixture(), { [FILE]: { contextId: 'product-image', status: 'active' } });
    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(out.results).toEqual([{ imageKey: 'IMG-1', usage: 'main', ok: true, error: null }]);
    expect(fixture.images[0].status).toBe('resolved');
    expect(fixture.images[0].fileId).toBe(FILE);
  });

  it('요구가 전부 채워지면 phase 가 drafting 으로 전진한다', async () => {
    const { manager, fixture } = harness(baseFixture(), { [FILE]: { contextId: 'product-image', status: 'active' } });
    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(fixture.sessions[0].phase).toBe('drafting');
    expect(out.progress.phase).toBe('drafting');
  });

  it('요구가 남으면 전진하지 않는다', async () => {
    const fixture = baseFixture();
    fixture.items[0].payload = {
      fields: {},
      imageRefs: [
        { imageKey: 'IMG-1', usage: 'main' },
        { imageKey: 'IMG-2', usage: 'main' },
      ],
    };
    fixture.images.push({
      id: 'img-row-2',
      sessionId: SESSION,
      imageKey: 'IMG-2',
      usage: 'main',
      sourceKind: 'file_name',
      sourceValue: 'back.jpg',
      status: 'awaiting_upload',
      fileId: null,
    });
    const { manager } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(fixture.sessions[0].phase).toBe('awaiting_images');
  });

  // 이 케이스가 게이트의 존재 이유다 — invalid 행만 참조하던 이미지는 영원히 안 올라온다.
  it('아무도 참조하지 않는 미해결 이미지가 남아도 전진한다', async () => {
    const fixture = baseFixture();
    fixture.images.push({
      id: 'img-row-9',
      sessionId: SESSION,
      imageKey: 'IMG-9',
      usage: 'main',
      sourceKind: 'file_name',
      sourceValue: 'ghost.jpg',
      status: 'awaiting_upload',
      fileId: null,
    });
    const { manager } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(fixture.sessions[0].phase).toBe('drafting');
  });

  it('없는 참조는 그 항목만 실패한다 — 나머지는 기록된다', async () => {
    const fixture = baseFixture();
    fixture.items[0].payload = { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] };
    const { manager } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    const out = await manager.resolve(SESSION, USER, [
      { imageKey: 'GHOST', usage: 'main', fileId: FILE },
      { imageKey: 'IMG-1', usage: 'main', fileId: FILE },
    ]);
    expect(out.results[0].ok).toBe(false);
    expect(out.results[1].ok).toBe(true);
    expect(fixture.images[0].status).toBe('resolved');
  });

  it('file-service 에 없는 fileId 는 거절한다', async () => {
    const { manager, fixture } = harness(baseFixture(), {});
    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(out.results[0].ok).toBe(false);
    expect(fixture.images[0].status).toBe('awaiting_upload');
  });

  it('용도와 컨텍스트가 어긋난 파일은 거절한다', async () => {
    const { manager } = harness(baseFixture(), {
      [FILE]: { contextId: 'product-description-image', status: 'active' },
    });
    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(out.results[0].ok).toBe(false);
    expect(out.results[0].error).toContain('product-image');
  });

  it('양식에 파일ID로 적힌 행(sourceKind=file_id)은 업로드로 교체할 수 없다', async () => {
    const fixture = baseFixture();
    fixture.images[0].sourceKind = 'file_id';
    fixture.images[0].status = 'resolved';
    fixture.images[0].fileId = '00000000-0000-7000-8000-0000000000bb';
    const { manager } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(out.results[0].ok).toBe(false);
    expect(fixture.images[0].fileId).toBe('00000000-0000-7000-8000-0000000000bb');
  });

  it('이미 올린 파일을 교체하면 옛 파일을 지운다', async () => {
    const OLD = '00000000-0000-7000-8000-0000000000cc';
    const fixture = baseFixture();
    fixture.images[0].status = 'resolved';
    fixture.images[0].fileId = OLD;
    const { manager, softDeleted } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(fixture.images[0].fileId).toBe(FILE);
    expect(softDeleted).toEqual([OLD]);
  });

  it('같은 fileId 를 다시 통보하면 옛 파일을 지우지 않는다 — 자기 자신을 지우는 사고', async () => {
    const fixture = baseFixture();
    fixture.images[0].status = 'resolved';
    fixture.images[0].fileId = FILE;
    const { manager, softDeleted } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);
    expect(out.results[0].ok).toBe(true);
    expect(softDeleted).toEqual([]);
  });

  it('한 요청 안의 중복은 마지막 것만 적용한다', async () => {
    const SECOND = '00000000-0000-7000-8000-0000000000dd';
    const { manager, fixture, softDeleted } = harness(baseFixture(), {
      [FILE]: { contextId: 'product-image', status: 'active' },
      [SECOND]: { contextId: 'product-image', status: 'active' },
    });
    const out = await manager.resolve(SESSION, USER, [
      { imageKey: 'IMG-1', usage: 'main', fileId: FILE },
      { imageKey: 'IMG-1', usage: 'main', fileId: SECOND },
    ]);
    expect(out.results).toHaveLength(1);
    expect(fixture.images[0].fileId).toBe(SECOND);
    expect(softDeleted).toEqual([]);
  });

  it('상한을 넘긴 요청은 매니저가 거절한다 — DTO 가 뚫려도 서버가 막는다', async () => {
    const { manager } = harness(baseFixture());
    const many = Array.from({ length: 51 }, (_, i) => ({ imageKey: `IMG-${i}`, usage: 'main' as const, fileId: FILE }));
    await expect(manager.resolve(SESSION, USER, many)).rejects.toThrow('50');
  });

  // 리뷰 Important #1 — getMetadata 가 5xx/타임아웃으로 던지면 그 항목만 실패해야 한다.
  // 잡지 않으면 resolve 전체가 throw 해 앞서 통과한 항목까지 한 건도 기록되지 않는다
  // (부분 성공 설계 붕괴, S3 고아 발생). 이 테스트가 그 회귀를 고정한다.
  it('메타데이터 확인이 예외를 던지면 그 항목만 실패하고 나머지는 기록된다 — 부분 성공 유지', async () => {
    const THROWING = '00000000-0000-7000-8000-0000000000ee';
    const fixture = baseFixture();
    fixture.items[0].payload = {
      fields: {},
      imageRefs: [
        { imageKey: 'IMG-1', usage: 'main' },
        { imageKey: 'IMG-2', usage: 'main' },
      ],
    };
    fixture.images.push({
      id: 'img-row-2',
      sessionId: SESSION,
      imageKey: 'IMG-2',
      usage: 'main',
      sourceKind: 'file_name',
      sourceValue: 'back.jpg',
      status: 'awaiting_upload',
      fileId: null,
    });
    const { manager } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } }, [THROWING]);

    // resolve 자체는 던지지 않는다 — 이게 이 수정의 요점이다.
    const out = await manager.resolve(SESSION, USER, [
      { imageKey: 'IMG-1', usage: 'main', fileId: THROWING },
      { imageKey: 'IMG-2', usage: 'main', fileId: FILE },
    ]);

    const first = out.results.find((r) => r.imageKey === 'IMG-1');
    const second = out.results.find((r) => r.imageKey === 'IMG-2');
    expect(first?.ok).toBe(false);
    expect(second?.ok).toBe(true);
    // 원문 예외 텍스트가 그대로 새면 안 된다 — 관리자 화면에 렌더된다.
    expect(first?.error).not.toContain('502');
    expect(fixture.images[0].status).toBe('awaiting_upload'); // IMG-1: 실패, 기록 안 됨
    expect(fixture.images[1].status).toBe('resolved'); // IMG-2: 통과, 기록됨
  });

  // 리뷰 Important #2 — 전진 CAS 는 phase 뿐 아니라 cancelRequestedAt 도 본다. 어느 하나만
  // 검사해도 기존 14건은 전부 초록이었다(픽스처가 cancelRequestedAt 을 채운 적이 없었다).
  // 이 테스트가 그 조건을 실제로 고정한다 — 취소 요청이 낀 세션은 이미지가 다 채워져도
  // drafting 으로 못 간다("취소됐는데 phase 는 drafting" 좀비 방지).
  it('취소 요청이 걸린 세션은 요구가 전부 채워져도 전진하지 않는다', async () => {
    const fixture = baseFixture();
    fixture.sessions[0].cancelRequestedAt = new Date('2026-08-01T00:00:00Z');
    const { manager } = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });

    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);

    expect(out.results[0].ok).toBe(true); // 파일 기록 자체는 성공한다
    expect(fixture.images[0].status).toBe('resolved');
    expect(fixture.sessions[0].phase).toBe('awaiting_images'); // CAS 가 졌다
    expect(out.progress.phase).toBe('awaiting_images');
  });
});

/**
 * ③이 세션 행을 `FOR UPDATE` 로 잠그면서 **phase 를 다시 읽는다**.
 *
 * ①의 phase 검사와 ③ 사이에는 ②의 HTTP 왕복(최대 50건 × 5초)이 있어 그 창에서 phase 가
 * 움직일 수 있다. 다른 탭이 먼저 `drafting` 으로 전진시키고 4단계 워커가 draft 를 만든
 * 뒤, 늦게 도착한 이 요청이 fileId 를 갈아끼우면 ④가 **draft 가 참조 중인 파일을 soft
 * delete** 한다. 3단계에는 drafting 워커가 없어 아직 도달 불가지만 4단계에서 활성화된다.
 *
 * 페이크는 ①과 ③ 사이의 실제 인터리브를 만들 수 없으므로, ②(getMetadata)가 불리는 순간
 * 픽스처의 phase 를 바꿔 그 창을 재현한다 — ①은 `awaiting_images` 를 보고 통과하고 ③은
 * 바뀐 phase 를 본다.
 */
describe('BulkImageManager.resolve — ③ 잠금 후 phase 재확인', () => {
  function racingHarness(phaseAfterMetadata: string) {
    const fixture = baseFixture();
    const base = harness(fixture, { [FILE]: { contextId: 'product-image', status: 'active' } });
    const original = base.fileClient.getMetadata;
    // ②가 도는 동안 다른 탭이 세션을 전진시킨 것과 같은 상태를 만든다.
    base.fileClient.getMetadata = (fileId: string) => {
      fixture.sessions[0].phase = phaseAfterMetadata;
      return original(fileId);
    };
    return base;
  }

  it('②를 도는 사이 phase 가 drafting 으로 바뀌면 이미지 행을 갱신하지 않는다', async () => {
    const { manager, fixture } = racingHarness('drafting');

    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);

    // 이미지 행은 손대지 않았다 — 4단계 draft 가 이미 참조 중일 수 있다.
    expect(fixture.images[0].status).toBe('awaiting_upload');
    expect(fixture.images[0].fileId).toBeNull();
    expect(fixture.sessions[0].phase).toBe('drafting');
    // 기록하지 않았으므로 성공이라고 답하면 안 된다 — 화면이 업로드 완료로 믿으면
    // 그 파일은 아무도 안 쓰는 S3 고아가 되고 작업자에겐 되돌릴 길이 없다.
    expect(out.results[0].ok).toBe(false);
    expect(out.results[0].error).toContain('단계');
  });

  it('그 경우 교체된 옛 파일도 지우지 않는다 — 새 fileId 가 안 적혔는데 옛것을 지우면 파일이 사라진다', async () => {
    const OLD = '00000000-0000-7000-8000-0000000000cc';
    const { manager, softDeleted, fixture } = racingHarness('canceled');
    fixture.images[0].status = 'resolved';
    fixture.images[0].fileId = OLD;

    await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);

    expect(softDeleted).toEqual([]);
    expect(fixture.images[0].fileId).toBe(OLD);
  });

  it('phase 가 그대로면 평소처럼 기록한다 — 재확인이 정상 경로를 막지 않는다', async () => {
    const { manager, fixture } = racingHarness('awaiting_images');

    const out = await manager.resolve(SESSION, USER, [{ imageKey: 'IMG-1', usage: 'main', fileId: FILE }]);

    expect(out.results[0].ok).toBe(true);
    expect(fixture.images[0].status).toBe('resolved');
    expect(fixture.sessions[0].phase).toBe('drafting');
  });
});
