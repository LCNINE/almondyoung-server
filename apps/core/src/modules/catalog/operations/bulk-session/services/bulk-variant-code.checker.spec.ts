import { BulkVariantCodeChecker } from './bulk-variant-code.checker';
import { rowMatchesCondition } from './__support__/drizzle-row-matcher';
import type { BulkItemPayload, FlatFields } from './bulk-session.types';

interface FakeItemRow {
  id: string;
  sessionId: string;
  rowNumber: number;
  masterId: string | null;
  status: string;
  payload: BulkItemPayload;
  errorMessage: string | null;
}

interface ActiveCodeRow {
  variantCode: string;
  masterId: string;
}

/** payload.fields 를 감싼다 — `variant:<조합>.variantCode` 키만 쓰면 된다. */
function fieldsWith(fields: FlatFields): BulkItemPayload {
  return { fields };
}

/**
 * `checker.checkSession('S1')` 을 부르는 모든 테스트가 공유하는 sessionId 라 기본값으로
 * 채운다 — 브리프의 픽스처들은 sessionId 를 명시하지 않는다.
 */
function itemRow(overrides: Partial<FakeItemRow> & { id: string; payload: BulkItemPayload }): FakeItemRow {
  return {
    sessionId: 'S1',
    rowNumber: 1,
    masterId: null,
    status: 'pending',
    errorMessage: null,
    ...overrides,
  };
}

/**
 * `select().from(productBulkItems).where(...)` 는 프로덕션이 넘긴 **실제 조건**으로 걸러야
 * 한다(고정 `.filter(status==='pending')` 를 하네스에 하드코딩하면, 프로덕션이 그 필터를
 * 잃어도 테스트가 계속 초록이라 회귀를 못 잡는다 — `bulk-session.cleaner.spec.ts` 의 선례와
 * 같은 이유로 `rowMatchesCondition` 을 쓴다).
 *
 * `selectDistinct(...).from(productVariants).innerJoin().innerJoin().where(...)` 는 join 세
 * 테이블을 페이크로 재현하지 않고 `activeCodes` 를 그대로 돌려준다 — v3 checker 스펙의
 * `findActiveVariantCodes` 스텁과 같은 깊이다. 프로덕션이 실제로 이 모양의 쿼리를 만드는지는
 * 별도로 손으로 확인했다(보고서 참조).
 */
function harness(opts: {
  items: Array<Partial<FakeItemRow> & { id: string; payload: BulkItemPayload }>;
  activeCodes?: ActiveCodeRow[];
}) {
  const itemRows = opts.items.map((item) => itemRow(item));
  const activeCodes = opts.activeCodes ?? [];

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
          innerJoin: () => ({
            where: () => Promise.resolve(activeCodes),
          }),
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
  const checker = new BulkVariantCodeChecker(db as never);

  return { checker, itemRows };
}

describe('BulkVariantCodeChecker', () => {
  it('세션 안에서 같은 코드를 두 행이 주장하면 양쪽 다 invalid 다', async () => {
    const { checker, itemRows } = harness({
      items: [
        { id: 'I1', rowNumber: 2, status: 'pending', payload: fieldsWith({ 'variant:A.variantCode': 'SKU-1' }) },
        { id: 'I2', rowNumber: 3, status: 'pending', payload: fieldsWith({ 'variant:B.variantCode': 'SKU-1' }) },
      ],
    });
    await checker.checkSession('S1');
    expect(itemRows[0].status).toBe('invalid');
    expect(itemRows[1].status).toBe('invalid');
    expect(itemRows[0].errorMessage).toContain('SKU-1');
  });

  it('다른 상품이 이미 쓰는 코드는 invalid 다', async () => {
    const { checker, itemRows } = harness({
      items: [
        { id: 'I1', masterId: 'M1', status: 'pending', payload: fieldsWith({ 'variant:A.variantCode': 'SKU-9' }) },
      ],
      activeCodes: [{ variantCode: 'SKU-9', masterId: 'M-other' }],
    });
    await checker.checkSession('S1');
    expect(itemRows[0].status).toBe('invalid');
  });

  it('자기 상품이 이미 쓰는 코드는 오류가 아니다', async () => {
    // 수정 행이 자기 variant 들 사이에서 코드를 옮기는 것은 정상이다. 같은 버전 안의
    // 진짜 중복은 발행 시점 `_validateVariantCodeUniqueness` 가 잡는다.
    const { checker, itemRows } = harness({
      items: [
        { id: 'I1', masterId: 'M1', status: 'pending', payload: fieldsWith({ 'variant:A.variantCode': 'SKU-9' }) },
      ],
      activeCodes: [{ variantCode: 'SKU-9', masterId: 'M1' }],
    });
    await checker.checkSession('S1');
    expect(itemRows[0].status).toBe('pending');
  });

  it('이미 invalid 인 행은 다시 건드리지 않는다 — 재실행이 문구를 겹쳐 쌓지 않는다', async () => {
    const { checker, itemRows } = harness({
      items: [
        {
          id: 'I1',
          status: 'invalid',
          errorMessage: '기존 오류',
          payload: fieldsWith({ 'variant:A.variantCode': 'SKU-1' }),
        },
      ],
      activeCodes: [{ variantCode: 'SKU-1', masterId: 'M-other' }],
    });
    await checker.checkSession('S1');
    expect(itemRows[0].errorMessage).toBe('기존 오류');
  });
});
