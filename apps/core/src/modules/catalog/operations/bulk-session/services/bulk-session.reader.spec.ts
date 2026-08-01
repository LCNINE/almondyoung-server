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

function selectChain(rows: FakeRow[], isCount: boolean): SelectChain {
  const resolved = isCount ? [{ value: rows.length }] : rows;
  const builder = Promise.resolve(resolved) as SelectChain;
  builder.where = (condition) =>
    selectChain(
      rows.filter((row) => rowMatchesCondition(row, condition)),
      isCount,
    );
  builder.orderBy = () => builder;
  // 이 리더가 groupBy 하는 유일한 축은 status 다(getProgress 의 itemCounts/imageCounts) —
  // 실제로 status 별로 세어 `{status, value}` 를 돌려준다.
  builder.groupBy = () => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const status = String(row.status);
      counts.set(status, (counts.get(status) ?? 0) + 1);
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
  return { reader };
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
