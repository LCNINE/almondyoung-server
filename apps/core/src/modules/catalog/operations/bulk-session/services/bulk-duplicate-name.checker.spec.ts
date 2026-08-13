import { BulkDuplicateNameChecker } from './bulk-duplicate-name.checker';
import { rowMatchesCondition } from './__support__/drizzle-row-matcher';
import type { BulkItemPayload } from './bulk-session.types';

interface FakeItemRow {
  id: string;
  sessionId: string;
  rowNumber: number;
  kind: string;
  status: string;
  payload: BulkItemPayload;
  errorMessage: string | null;
}

interface ActiveNameRow {
  name: string;
  productCode: string | null;
  masterId: string;
}

function named(name: string): BulkItemPayload {
  return { fields: { 'product.name': name } };
}

function itemRow(overrides: Partial<FakeItemRow> & { id: string; payload: BulkItemPayload }): FakeItemRow {
  return {
    sessionId: 'S1',
    rowNumber: 1,
    kind: 'create',
    status: 'pending',
    errorMessage: null,
    ...overrides,
  };
}

/**
 * `bulk-variant-code.checker.spec.ts` 와 같은 하네스다 — items 는 프로덕션이 넘긴 **실제
 * 조건**으로 거르고(고정 필터를 하드코딩하면 프로덕션이 그 절을 잃어도 초록이다),
 * `selectDistinct(...).innerJoin().where()` 는 join 을 재현하지 않고 `activeNames` 를 돌려준다.
 */
function harness(opts: {
  items: Array<Partial<FakeItemRow> & { id: string; payload: BulkItemPayload }>;
  activeNames?: ActiveNameRow[];
}) {
  const itemRows = opts.items.map((item) => itemRow(item));
  const activeNames = opts.activeNames ?? [];

  const trx = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) =>
          Promise.resolve(itemRows.filter((row) => rowMatchesCondition(row as never, condition))),
      }),
    }),
    selectDistinct: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(activeNames),
        }),
      }),
    }),
    update: () => ({
      set: (values: Partial<FakeItemRow>) => ({
        where: (condition: unknown) => {
          const row = itemRows.find((r) => rowMatchesCondition(r as never, condition));
          if (row) Object.assign(row, values);
          return Promise.resolve([]);
        },
      }),
    }),
  };

  const db = { run: (fn: (t: unknown) => unknown) => fn(trx) };
  return { checker: new BulkDuplicateNameChecker(db as never), itemRows };
}

describe('BulkDuplicateNameChecker', () => {
  it('같은 상품명의 판매 중인 상품이 있으면 신규 행이 invalid 다 (이슈 #630 재업로드)', async () => {
    const { checker, itemRows } = harness({
      items: [{ id: 'I1', payload: named('[그레이거] 페이스 필름 커버 (50매입)') }],
      activeNames: [{ name: '[그레이거] 페이스 필름 커버 (50매입)', productCode: 'AY-20030', masterId: 'M1' }],
    });
    expect(await checker.checkSession('S1')).toBe(1);
    expect(itemRows[0].status).toBe('invalid');
    expect(itemRows[0].errorMessage).toContain('AY-20030');
  });

  it('파일 안에서 상품명이 겹치면 양쪽 다 invalid 다', async () => {
    const { checker, itemRows } = harness({
      items: [
        { id: 'I1', rowNumber: 2, payload: named('같은 상품') },
        { id: 'I2', rowNumber: 3, payload: named('같은 상품') },
      ],
    });
    await checker.checkSession('S1');
    expect(itemRows.map((r) => r.status)).toEqual(['invalid', 'invalid']);
    expect(itemRows[0].errorMessage).toContain('3행');
  });

  it('겹치지 않는 이름은 통과한다', async () => {
    const { checker, itemRows } = harness({
      items: [{ id: 'I1', payload: named('새 상품') }],
      activeNames: [{ name: '다른 상품', productCode: 'AY-1', masterId: 'M1' }],
    });
    expect(await checker.checkSession('S1')).toBe(0);
    expect(itemRows[0].status).toBe('pending');
  });

  it('수정 행은 보지 않는다 — 자기 master 의 이름이라 항상 걸린다', async () => {
    const { checker, itemRows } = harness({
      items: [{ id: 'I1', kind: 'update', payload: named('기존 상품') }],
      activeNames: [{ name: '기존 상품', productCode: 'AY-9', masterId: 'M1' }],
    });
    await checker.checkSession('S1');
    expect(itemRows[0].status).toBe('pending');
  });

  it('이미 invalid 인 행은 다시 건드리지 않는다 — 재실행이 문구를 겹쳐 쌓지 않는다', async () => {
    const { checker, itemRows } = harness({
      items: [{ id: 'I1', status: 'invalid', errorMessage: '기존 오류', payload: named('기존 상품') }],
      activeNames: [{ name: '기존 상품', productCode: 'AY-9', masterId: 'M1' }],
    });
    await checker.checkSession('S1');
    expect(itemRows[0].errorMessage).toBe('기존 오류');
  });
});
