import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';

jest.mock('../../workflows/orders/steps/create-review-eligibility-step', () => ({
  createReviewEligibility: jest.fn(),
}));

import autoReviewEligibility from '../auto-review-eligibility';
import { createReviewEligibility } from '../../workflows/orders/steps/create-review-eligibility-step';

/**
 * 🔴 이 스펙이 지키는 성질: **요약 줄이 «주문 수»와 «행 수»를 둘 다 낸다.**
 *
 * 자격은 주문의 라인마다 하나씩 생기는데 `issued` 는 주문 단위로 센다. 한 쪽만 찍으면 운영자가
 * 로그 한 줄로 발급량을 읽을 수 없고, 실제 행 수와 배율만큼 어긋난 값을 발급량으로 읽게 된다.
 * 실제 배율은 `select count(*), count(distinct order_id) from review_eligibilities` 가 준다.
 *
 * 두 수가 «서로 다른» 입력을 골랐다 — 같은 값이면 둘 중 하나가 빠져도 통과한다.
 */
describe('자동 자격 발급 잡의 요약 줄', () => {
  const ORIGINAL_ENV = { ...process.env };
  const mockedCreate = createReviewEligibility as jest.MockedFunction<typeof createReviewEligibility>;

  /** 발급 대상이 되도록 충분히 오래된 주문 하나. 판정 규칙은 lib 쪽 스펙이 따로 못 박는다. */
  const candidate = (id: string) => ({
    order_id: id,
    created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    attempts: null,
  });

  function makeContainer(orderIds: string[], logs: string[]) {
    const logger = {
      info: (msg: string) => logs.push(msg),
      warn: (msg: string) => logs.push(msg),
      error: (msg: string) => logs.push(msg),
    };
    const knex = { raw: async () => ({ rows: orderIds.map(candidate) }) };
    const query = {
      graph: async () => ({
        data: [
          {
            id: orderIds[0],
            customer_id: 'cus_1',
            items: [
              { id: 'line_1', product_id: 'prod_1', unit_price: 1000, detail: { quantity: 1 } },
              { id: 'line_2', product_id: 'prod_2', unit_price: 1000, detail: { quantity: 1 } },
              { id: 'line_3', product_id: 'prod_3', unit_price: 1000, detail: { quantity: 1 } },
            ],
          },
        ],
      }),
    };
    const orderModule = { updateOrders: async () => undefined };
    return {
      resolve: (key: unknown) => {
        if (key === ContainerRegistrationKeys.LOGGER) return logger;
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return knex;
        if (key === ContainerRegistrationKeys.QUERY) return query;
        if (key === Modules.ORDER) return orderModule;
        return undefined;
      },
    };
  }

  beforeEach(() => {
    process.env.ELIGIBILITY_AUTO_ISSUE = 'true';
    mockedCreate.mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('주문 하나에 여러 자격이 생기면 issued 와 rows 가 서로 다른 값으로 찍힌다', async () => {
    mockedCreate.mockResolvedValue({
      status: 'created',
      orderId: 'order_1',
      almondUserId: 'user_1',
      itemCount: 3,
      createdCount: 3,
    });
    const logs: string[] = [];

    const summary = await autoReviewEligibility({ container: makeContainer(['order_1'], logs) } as never);

    expect(summary.issued).toBe(1);
    expect(summary.rows).toBe(3);

    const line = logs.find((l) => l.includes('scanned='));
    expect(line).toBeDefined();
    expect(line).toContain('issued=1');
    expect(line).toContain('rows=3');
  });

  it('멱등 재시도로 실제 생성이 요청보다 적으면 rows 는 «만들어진» 수를 낸다', async () => {
    mockedCreate.mockResolvedValue({
      status: 'created',
      orderId: 'order_1',
      almondUserId: 'user_1',
      itemCount: 3,
      createdCount: 1,
    });
    const logs: string[] = [];

    const summary = await autoReviewEligibility({ container: makeContainer(['order_1'], logs) } as never);

    expect(summary.issued).toBe(1);
    expect(summary.rows).toBe(1);
    expect(logs.find((l) => l.includes('scanned='))).toContain('rows=1');
  });

  it('발급되지 않은 주문은 행 수에 더해지지 않는다', async () => {
    mockedCreate.mockResolvedValue({ status: 'skipped', orderId: 'order_1', reason: 'no_pim_backed_items' });
    const logs: string[] = [];

    const summary = await autoReviewEligibility({ container: makeContainer(['order_1'], logs) } as never);

    expect(summary.issued).toBe(0);
    expect(summary.rows).toBe(0);
    expect(summary.skipped.nothing_to_issue).toBe(1);
  });
});
