import { NotFoundError } from '@app/shared';
import { PgDialect } from 'drizzle-orm/pg-core';
import { BulkSessionReader } from './bulk-session.reader';
import { productBulkImages, productBulkItems, productBulkSessions } from '../../../schema/catalog.schema';

type FakeRow = Record<string, unknown>;

/**
 * Task 10 리뷰 #3 픽스: 이전 버전은 `.where(condition)` 를 통째로 무시하는 고정 큐였다 —
 * `getProgress`/`getItems` 가 `eq(sessionId, ...)` 로 좁혀지는지, 세션이 여러 개일 때 남의
 * 세션 행이 섞이지 않는지를 전혀 검증하지 못했다(그 WHERE 가 빠져도 테스트가 그대로
 * 초록이었다). 이제 `.where()` 에 실제로 넘어온 drizzle 조건을 `PgDialect().sqlToQuery()`
 * 로 렌더해 `"컬럼" = $n` 패턴을 뽑아 픽스처 행에 대고 진짜로 필터링한다 — 같은 렌더 기법을
 * bulk-session-job.manager.spec.ts 의 renderQuery 가 어서션 용도로 이미 쓴다(여기서는 그
 * 결과로 실제 필터링까지 한다는 점이 다르다, bulk-session.manager.spec.ts 의 writeHarness
 * 와 동일한 기법).
 */
const dialect = new PgDialect();

function toCamelKey(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function rowMatchesCondition(row: FakeRow, condition: unknown): boolean {
  if (condition === undefined) return true;
  const { sql, params } = dialect.sqlToQuery(condition as never);
  const lowered = sql.toLowerCase();
  let ok = true;
  for (const m of lowered.matchAll(/"(\w+)"\s*=\s*\$(\d+)/g)) {
    const key = toCamelKey(m[1]);
    if (row[key] !== params[Number(m[2]) - 1]) ok = false;
  }
  return ok;
}

/** `{ value: count() }` 만 요청한 select 인지 — 이 리더의 유일한 스칼라 집계 모양이다. */
function isCountQuery(fields: unknown): boolean {
  if (typeof fields !== 'object' || fields === null) return false;
  const keys = Object.keys(fields);
  return keys.length === 1 && keys[0] === 'value';
}

interface SelectChain extends Promise<FakeRow[]> {
  where(condition?: unknown): SelectChain;
  orderBy(...args: unknown[]): SelectChain;
  groupBy(...args: unknown[]): SelectChain;
  limit(n?: number): SelectChain;
  offset(n?: number): SelectChain;
}

/**
 * `groupBy(column)` 에 실제로 넘어온 drizzle 컬럼에서 SQL 컬럼명을 뽑아 픽스처 키
 * (camelCase)로 바꾼다. **`status` 로 고정하면 안 된다** — 이 리더는 이미 세 축을
 * groupBy 한다: `productBulkItems.status`, `productBulkImages.status`,
 * `productBulkItems.publishStatus`(Task 8). 고정 `row.status` 를 쓰면 `publishStatus` 로
 * 그룹핑한 쿼리가 픽스처의 (전혀 다른 의미인) `status` 필드를 세는 거짓-초록이 생긴다 —
 * Task 8 브리프가 명시적으로 경고한 함정이다.
 */
function groupByField(column: unknown): string {
  const named = column as { name?: unknown };
  return typeof named.name === 'string' ? toCamelKey(named.name) : 'status';
}

function selectChain(rows: FakeRow[], isCount: boolean): SelectChain {
  const resolved = isCount ? [{ value: rows.length }] : rows;
  const builder = Promise.resolve(resolved) as SelectChain;
  builder.where = (condition) =>
    selectChain(
      rows.filter((row) => rowMatchesCondition(row, condition)),
      isCount,
    );
  builder.orderBy = () => builder;
  // 실제로 groupBy 에 넘어온 컬럼(들 중 첫 번째)이 가리키는 필드로 세어 `{status, value}`
  // 를 돌려준다 — 출력 키가 `status` 인 것은 세 그룹핑 쿼리 전부 `{ status: <col>, value:
  // count() }` 로 프로젝션하기 때문이지, 입력 필드가 항상 `status` 라서가 아니다.
  builder.groupBy = (...groupArgs) => {
    const field = groupByField(groupArgs[0]);
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = String(row[field]);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return selectChain(
      [...counts.entries()].map(([status, value]) => ({ status, value })),
      false,
    );
  };
  builder.limit = () => builder;
  builder.offset = () => builder;
  return builder;
}

interface FakeTrx {
  select: (fields?: unknown) => { from: (table: unknown) => SelectChain };
}

function tableKey(table: unknown): 'sessions' | 'items' | 'images' | 'other' {
  if (table === productBulkSessions) return 'sessions';
  if (table === productBulkItems) return 'items';
  if (table === productBulkImages) return 'images';
  return 'other';
}

interface HarnessTables {
  sessions?: FakeRow[];
  items?: FakeRow[];
  images?: FakeRow[];
}

function harness(tables: HarnessTables) {
  const state = { sessions: tables.sessions ?? [], items: tables.items ?? [], images: tables.images ?? [] };
  const trx: FakeTrx = {
    select: (fields) => ({
      from: (table) => {
        const key = tableKey(table);
        const rows =
          key === 'sessions' ? state.sessions : key === 'items' ? state.items : key === 'images' ? state.images : [];
        return selectChain(rows, isCountQuery(fields));
      },
    }),
  };
  const db = { run: <T>(fn: (t: FakeTrx) => Promise<T>) => fn(trx) };
  // 생성자는 실제 DbService<PimSchema> 타입을 요구한다 — 이 페이크는 run() 만 구조적으로
  // 흉내내므로 `as never` 캐스팅은 bulk-session.manager.spec.ts harness 와 같은 관례.
  const reader = new BulkSessionReader(db as never);
  // 3단계: hasPendingImageWork(trx, ...) 처럼 trx 를 명시로 받는 메서드를 테스트하려면
  // 하네스가 만든 그 trx 가 필요하다. FakeTrx 는 select() 구조만 흉내내므로 실제
  // DbTransaction 자리에 넣을 때는 위 `db as never` 와 같은 관례를 쓴다.
  return { reader, trx: trx as never };
}

const SESSION_ROW: FakeRow = {
  id: 'sess-1',
  uploadedBy: 'u1',
  phase: 'review',
  phaseError: null,
  totalRows: 3,
  cancelRequestedAt: null,
};

describe('BulkSessionReader.getProgress', () => {
  it('단계별 집계를 매번 계산한다 — items·images 를 status 로 GROUP BY 하고, 다른 세션 행은 섞지 않는다', async () => {
    const { reader } = harness({
      sessions: [SESSION_ROW],
      items: [
        { sessionId: 'sess-1', status: 'pending' },
        { sessionId: 'sess-1', status: 'pending' },
        { sessionId: 'sess-1', status: 'invalid' },
        // 다른 세션의 행 — eq(sessionId) 가 빠지면 이 행까지 집계에 섞인다.
        { sessionId: 'other-session', status: 'pending' },
      ],
      images: [
        { sessionId: 'sess-1', status: 'awaiting_upload' },
        { sessionId: 'other-session', status: 'awaiting_upload' },
      ],
    });

    const progress = await reader.getProgress('sess-1', 'u1');

    expect(progress.itemCounts).toEqual([
      { status: 'pending', count: 2 },
      { status: 'invalid', count: 1 },
    ]);
    expect(progress.imageCounts).toEqual([{ status: 'awaiting_upload', count: 1 }]);
    // Task 10 리뷰 #6: itemCounts 의 합이 진행률의 올바른 분모다 — totalRows 는 "상품 시트
    // 행 수"일 뿐이라 섞으면 안 된다(둘이 우연히 같아도 의미가 다르다).
    expect(progress.itemTotal).toBe(3);
    // totalRows 는 세션 행에서 그대로 온 것이지 items 집계의 합이 아니다.
    expect(progress.totalRows).toBe(3);
    expect(progress.phase).toBe('review');
  });

  // Task 8: 발행 단계는 아이템 status 와 축이 다르다 — 한 행이 status='drafted' 이면서
  // publishStatus='failed' 일 수 있다. 여러 상태가 섞인 픽스처로 각 그룹의 개수가 맞는지
  // 단정한다(브리프의 "집계 페이크" 경고 — 그룹핑 축을 잘못 잡으면 이 테스트가 거짓 초록이
  // 된다). `toHaveLength(2)` 를 같이 걸어 "축을 착각해 한 그룹으로 뭉치는" 실패도 잡는다.
  it('진행률이 publish_status 별 집계를 함께 준다', async () => {
    const { reader } = harness({
      sessions: [SESSION_ROW],
      items: [
        { sessionId: 'sess-1', status: 'drafted', publishStatus: 'published' },
        { sessionId: 'sess-1', status: 'drafted', publishStatus: 'published' },
        { sessionId: 'sess-1', status: 'drafted', publishStatus: 'failed' },
        // 다른 세션의 행 — eq(sessionId) 가 빠지면 이 행까지 집계에 섞인다.
        { sessionId: 'other-session', status: 'drafted', publishStatus: 'published' },
      ],
    });

    const progress = await reader.getProgress('sess-1', 'u1');

    expect(progress.publishCounts).toEqual(
      expect.arrayContaining([
        { status: 'published', count: 2 },
        { status: 'failed', count: 1 },
      ]),
    );
    expect(progress.publishCounts).toHaveLength(2);
  });

  it('남의 세션은 404 다 — 있는데 내 것 아님과 아예 없음을 구분해주지 않는다', async () => {
    const { reader } = harness({ sessions: [{ ...SESSION_ROW, uploadedBy: 'other' }] });

    await expect(reader.getProgress('sess-1', 'u1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('세션이 아예 없어도 같은 404 다', async () => {
    const { reader } = harness({ sessions: [] });

    await expect(reader.getProgress('sess-1', 'u1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('BulkSessionReader.getItems', () => {
  function itemRow(overrides: FakeRow = {}): FakeRow {
    return {
      id: 'item-1',
      sessionId: 'sess-1',
      rowNumber: 2,
      rowKey: 'P-1',
      kind: 'update',
      status: 'pending',
      masterId: 'm-1',
      errorMessage: null,
      payload: { fields: {} },
      conflict: null,
      conflictDecision: null,
      baseSnapshot: null,
      draftVersionId: null,
      ...overrides,
    };
  }

  // Task 10 리뷰 #1: 목록 응답에 id 가 없으면 PATCH .../items/:itemId/conflict-decision 을
  // 부를 방법이 없다(rowKey 로는 못 부른다 — 매니저는 productBulkItems.id 로 찾는다).
  it('행마다 conflict-decision 라우트에 쓸 id 가 실린다', async () => {
    const { reader } = harness({
      sessions: [SESSION_ROW],
      items: [itemRow({ id: 'item-42' })],
    });

    const result = await reader.getItems('sess-1', 'u1', undefined, 1, 20);

    expect(result.data[0].id).toBe('item-42');
  });

  it('변경분에 서버가 붙인 라벨이 함께 온다', async () => {
    const { reader } = harness({
      sessions: [SESSION_ROW],
      items: [
        itemRow({
          payload: { fields: { 'product.basePrice': '15000' } },
          baseSnapshot: {
            product: { basePrice: '10000' },
            options: [],
            variants: [],
            categories: [],
            constraint: null,
          },
        }),
      ],
    });

    const result = await reader.getItems('sess-1', 'u1', undefined, 1, 20);

    expect(result.data[0].changes[0]).toEqual({
      field: 'product.basePrice',
      label: '판매가',
      before: '10000',
      after: '15000',
    });
    expect(result.total).toBe(1);
  });

  it('create 행은 before 가 항상 빈 문자열이다 — 비교 대상이 없다', async () => {
    const { reader } = harness({
      sessions: [SESSION_ROW],
      items: [itemRow({ kind: 'create', payload: { fields: { 'product.name': '새 상품' } }, baseSnapshot: null })],
    });

    const result = await reader.getItems('sess-1', 'u1', undefined, 1, 20);

    expect(result.data[0].changes[0]).toMatchObject({ field: 'product.name', before: '', after: '새 상품' });
  });

  it('결정하지 않은 충돌은 decision: null 로 온다', async () => {
    const { reader } = harness({
      sessions: [SESSION_ROW],
      items: [
        itemRow({
          conflict: { 'product.brand': { base: 'A', mine: 'B', current: 'C' } },
          conflictDecision: null,
        }),
      ],
    });

    const result = await reader.getItems('sess-1', 'u1', undefined, 1, 20);

    expect(result.data[0].conflicts[0]).toEqual({
      field: 'product.brand',
      label: '브랜드',
      base: 'A',
      mine: 'B',
      current: 'C',
      decision: null,
    });
  });

  it('이미 결정된 충돌은 그 결정값을 그대로 싣는다', async () => {
    const { reader } = harness({
      sessions: [SESSION_ROW],
      items: [
        itemRow({
          conflict: { 'product.brand': { base: 'A', mine: 'B', current: 'C' } },
          conflictDecision: { 'product.brand': 'overwrite' },
        }),
      ],
    });

    const result = await reader.getItems('sess-1', 'u1', undefined, 1, 20);

    expect(result.data[0].conflicts[0].decision).toBe('overwrite');
  });

  // Task 10 리뷰 #3 계열 — getItems 도 getProgress 와 같은 sessionId 스코핑 위험이 있다.
  it('다른 세션의 행은 섞이지 않는다', async () => {
    const { reader } = harness({
      sessions: [SESSION_ROW],
      items: [itemRow({ id: 'item-1' }), itemRow({ id: 'item-2', sessionId: 'other-session' })],
    });

    const result = await reader.getItems('sess-1', 'u1', undefined, 1, 20);

    expect(result.data.map((row) => row.id)).toEqual(['item-1']);
    expect(result.total).toBe(1);
  });

  it('남의 세션은 404 다', async () => {
    const { reader } = harness({ sessions: [{ ...SESSION_ROW, uploadedBy: 'other' }] });

    await expect(reader.getItems('sess-1', 'u1', undefined, 1, 20)).rejects.toBeInstanceOf(NotFoundError);
  });

  // Task 9: draftVersionId 가 있어야 화면이 "생성된 draft 를 연다" 링크를 만들 수 있다.
  it('행 목록이 draftVersionId 를 내려준다', async () => {
    const { reader } = harness({
      sessions: [SESSION_ROW],
      items: [itemRow({ status: 'drafted', draftVersionId: 'draft-1' })],
    });

    const result = await reader.getItems('sess-1', 'u1', undefined, 1, 20);

    expect(result.data[0].draftVersionId).toBe('draft-1');
  });

  it('아직 draft 가 없는 행은 draftVersionId 가 null 이다', async () => {
    const { reader } = harness({
      sessions: [SESSION_ROW],
      items: [itemRow({ draftVersionId: null })],
    });

    const result = await reader.getItems('sess-1', 'u1', undefined, 1, 20);

    expect(result.data[0].draftVersionId).toBeNull();
  });

  // Task 8: 화면이 "무엇이 실패했는지" 보려면 publishStatus·publishError 가 행 목록에
  // 실려야 한다 — 지금까지는 진행률 집계에만 있고 행 단위로는 내려주지 않았다.
  it('행 목록이 발행 상태와 실패 사유를 함께 준다', async () => {
    const { reader } = harness({
      sessions: [SESSION_ROW],
      items: [itemRow({ id: 'I1', publishStatus: 'failed', publishError: '상품코드 중복' })],
    });

    const result = await reader.getItems('sess-1', 'u1', undefined, 1, 20);

    expect(result.data[0]).toMatchObject({ publishStatus: 'failed', publishError: '상품코드 중복' });
  });
});

describe('BulkSessionReader.getSessions', () => {
  it('내 세션만 담고 total·page·limit 을 함께 돌려준다 — 남의 세션은 섞이지 않는다', async () => {
    const { reader } = harness({
      sessions: [
        {
          id: 's1',
          uploadedBy: 'u1',
          name: '1월 등록',
          fileName: 'a.xlsx',
          phase: 'review',
          phaseError: null,
          totalRows: 5,
          cancelRequestedAt: null,
          createdAt: new Date(),
        },
        {
          id: 's2',
          uploadedBy: 'other',
          name: '남의 세션',
          fileName: 'b.xlsx',
          phase: 'review',
          phaseError: null,
          totalRows: 1,
          cancelRequestedAt: null,
          createdAt: new Date(),
        },
      ],
    });

    const result = await reader.getSessions('u1', 1, 20);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 's1', name: '1월 등록', phase: 'review' });
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });
});

describe('BulkSessionReader.hasPendingImageWork', () => {
  const SESSION = '00000000-0000-7000-8000-000000000001';
  const OTHER = '00000000-0000-7000-8000-0000000000ff';

  it('요구된 파일이 아직 안 올라왔으면 true', async () => {
    const { reader, trx } = harness({
      items: [
        {
          sessionId: SESSION,
          status: 'pending',
          payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] },
        },
      ],
      images: [{ sessionId: SESSION, imageKey: 'IMG-1', usage: 'main', status: 'awaiting_upload' }],
    });
    await expect(reader.hasPendingImageWork(trx, SESSION)).resolves.toBe(true);
  });

  it('전부 resolved 면 false', async () => {
    const { reader, trx } = harness({
      items: [
        {
          sessionId: SESSION,
          status: 'pending',
          payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] },
        },
      ],
      images: [{ sessionId: SESSION, imageKey: 'IMG-1', usage: 'main', status: 'resolved' }],
    });
    await expect(reader.hasPendingImageWork(trx, SESSION)).resolves.toBe(false);
  });

  // 이 한 줄이 이 술어의 존재 이유다 — invalid 행이 참조하던 파일까지 세면 작업자가
  // 절대 안 쓰일 파일을 올려야 다음으로 넘어간다.
  it('invalid 행만 참조하는 미해결 이미지는 세지 않는다', async () => {
    const { reader, trx } = harness({
      items: [
        {
          sessionId: SESSION,
          status: 'invalid',
          payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-9', usage: 'main' }] },
        },
      ],
      images: [{ sessionId: SESSION, imageKey: 'IMG-9', usage: 'main', status: 'awaiting_upload' }],
    });
    await expect(reader.hasPendingImageWork(trx, SESSION)).resolves.toBe(false);
  });

  it('아무도 참조하지 않는 미해결 이미지도 세지 않는다', async () => {
    const { reader, trx } = harness({
      items: [{ sessionId: SESSION, status: 'pending', payload: { fields: {} } }],
      images: [{ sessionId: SESSION, imageKey: 'IMG-ORPHAN', usage: 'main', status: 'awaiting_upload' }],
    });
    await expect(reader.hasPendingImageWork(trx, SESSION)).resolves.toBe(false);
  });

  it('용도가 다르면 다른 참조다 — 본문용만 참조된 키는 대표용 업로드를 기다리지 않는다', async () => {
    const { reader, trx } = harness({
      items: [
        {
          sessionId: SESSION,
          status: 'pending',
          payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'description' }] },
        },
      ],
      images: [{ sessionId: SESSION, imageKey: 'IMG-1', usage: 'main', status: 'awaiting_upload' }],
    });
    await expect(reader.hasPendingImageWork(trx, SESSION)).resolves.toBe(false);
  });

  it('남의 세션 행은 보지 않는다', async () => {
    const { reader, trx } = harness({
      items: [
        {
          sessionId: OTHER,
          status: 'pending',
          payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] },
        },
      ],
      images: [{ sessionId: OTHER, imageKey: 'IMG-1', usage: 'main', status: 'awaiting_upload' }],
    });
    await expect(reader.hasPendingImageWork(trx, SESSION)).resolves.toBe(false);
  });
});

describe('BulkSessionReader.getImages', () => {
  const SESSION = '00000000-0000-7000-8000-000000000001';
  const USER = '00000000-0000-7000-8000-000000000009';
  const ALL = { onlyRequired: false, page: 1, limit: 20 };

  // Task 3 리뷰 Important #1: image1Status/image9Status 오버라이드가 없으면 기존 6개
  // 테스트와 동일한 픽스처다(둘 다 awaiting_upload). requiredResolved 의 참(positive)
  // 분기 — required 이면서 resolved — 를 켜려면 image1Status 를 'resolved' 로 준다.
  function imageFixture(overrides: { image1Status?: string; image9Status?: string } = {}) {
    return {
      sessions: [{ id: SESSION, uploadedBy: USER }],
      items: [
        {
          sessionId: SESSION,
          status: 'pending',
          payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-1', usage: 'main' }] },
        },
        {
          sessionId: SESSION,
          status: 'invalid',
          payload: { fields: {}, imageRefs: [{ imageKey: 'IMG-9', usage: 'main' }] },
        },
      ],
      images: [
        {
          sessionId: SESSION,
          imageKey: 'IMG-1',
          usage: 'main',
          sourceKind: 'file_name',
          sourceValue: 'front.jpg',
          status: overrides.image1Status ?? 'awaiting_upload',
          fileId: null,
        },
        {
          sessionId: SESSION,
          imageKey: 'IMG-9',
          usage: 'main',
          sourceKind: 'file_name',
          sourceValue: 'ghost.jpg',
          status: overrides.image9Status ?? 'awaiting_upload',
          fileId: null,
        },
      ],
    };
  }

  it('pending 행이 참조하는 이미지만 required 다', async () => {
    const { reader } = harness(imageFixture());
    const out = await reader.getImages(SESSION, USER, ALL);
    expect(out.data.find((r) => r.imageKey === 'IMG-1')?.required).toBe(true);
    expect(out.data.find((r) => r.imageKey === 'IMG-9')?.required).toBe(false);
  });

  it('게이트 분모·분자는 required 기준이다', async () => {
    const { reader } = harness(imageFixture());
    const out = await reader.getImages(SESSION, USER, ALL);
    expect(out.requiredTotal).toBe(1);
    expect(out.requiredResolved).toBe(0);
  });

  // Task 3 리뷰 Important #1: 위 테스트는 이미지 두 개가 전부 awaiting_upload 라
  // requiredResolved 가 항상 0 을 기대했다 — 참(positive) 분기(row.status === 'resolved')가
  // 한 번도 실행되지 않았다. IMG-1(required, resolved)·IMG-9(비required, resolved) 를 같이
  // resolved 로 두면: (1) required 이면서 resolved 인 것이 분자에 실제로 잡히는지,
  // (2) resolved 라도 required 가 아니면 분자에서 빠지는지(분자가 requiredRows 에서만
  // 계산되는지) 를 한 픽스처로 같이 검증한다.
  it('requiredResolved 는 required 이면서 resolved 인 것만 센다 — resolved 라도 required 가 아니면 분자에서 빠진다', async () => {
    const { reader } = harness(imageFixture({ image1Status: 'resolved', image9Status: 'resolved' }));
    const out = await reader.getImages(SESSION, USER, ALL);
    expect(out.requiredTotal).toBe(1);
    expect(out.requiredResolved).toBe(1);
  });

  it('용도에 맞는 업로드 컨텍스트를 함께 준다 — 클라이언트가 매핑을 다시 들지 않게', async () => {
    const { reader } = harness(imageFixture());
    const out = await reader.getImages(SESSION, USER, ALL);
    expect(out.data[0].contextId).toBe('product-image');
  });

  it('onlyRequired 는 목록만 좁히고 요약 카운트는 세션 전체 기준을 유지한다', async () => {
    const { reader } = harness(imageFixture());
    const out = await reader.getImages(SESSION, USER, { ...ALL, onlyRequired: true });
    expect(out.data).toHaveLength(1);
    expect(out.total).toBe(1);
    expect(out.requiredTotal).toBe(1);
  });

  it('status 필터가 걸린다', async () => {
    const { reader } = harness(imageFixture());
    const out = await reader.getImages(SESSION, USER, { ...ALL, status: 'resolved' });
    expect(out.data).toHaveLength(0);
    expect(out.requiredTotal).toBe(1);
  });

  it('남의 세션이면 존재 검사와 같은 NotFoundError', async () => {
    const { reader } = harness(imageFixture());
    await expect(reader.getImages(SESSION, 'someone-else', ALL)).rejects.toBeInstanceOf(NotFoundError);
  });
});
