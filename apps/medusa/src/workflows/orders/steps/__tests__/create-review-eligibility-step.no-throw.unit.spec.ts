import { createReviewEligibility } from '../create-review-eligibility-step';

/**
 * 🔴 이 스펙이 지키는 성질 하나: **이 단계는 어떤 실패에도 던지지 않는다.**
 *
 * 구매확정 워크플로에서 이건 step 2 이고, 던지면 step 1(결제 캡처)의 보상 함수가 돈다 —
 * 그 보상은 `refundPaymentWorkflow` 를 «실제로» 부른다(`capture-order-payments-step.ts`).
 * 즉 리뷰 자격 생성이 실패하면 고객 결제가 환불된다. 자격이 없는 것보다 훨씬 나쁘고,
 * 자동 구매확정 잡이 이 경로를 대량으로 밟으므로 한 건의 ugc 장애가 다발 환불이 된다.
 *
 * 같은 파일이 이미 「PIM 마스터 id 를 못 찾으면 던지지 않고 조기 반환」으로 이 성질을 한 갈래에만
 * 두고 있었다. 여기서는 «모든» 갈래로 넓힌 것을 못 박는다.
 */
describe('createReviewEligibility 는 어떤 실패에도 던지지 않는다', () => {
  const ORIGINAL_ENV = { ...process.env };
  let fetchMock: jest.Mock;

  const baseInput = {
    customerId: 'cus_1',
    orderId: 'order_1',
    items: [{ id: 'line_1', product_id: 'prod_1', unit_price: 10000, detail: { quantity: 1 } }],
  };

  /** query.graph 가 customer → product 순으로 두 번 불린다. */
  function makeContainer(
    graph: (args: { entity: string }) => Promise<{ data: unknown[] }> = async ({ entity }) =>
      entity === 'customer'
        ? { data: [{ metadata: { almond_user_id: '11111111-1111-4111-8111-111111111111' } }] }
        : { data: [{ id: 'prod_1', handle: '22222222-2222-4222-8222-222222222222', metadata: {} }] },
  ) {
    return { resolve: () => ({ graph }) } as never;
  }

  beforeEach(() => {
    process.env.UGC_SERVICE_URL = 'http://ugc.test';
    process.env.UGC_INTERNAL_KEY = 'test-key';
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  it('정상 경로에서는 ugc 에 자격 생성을 요청한다', async () => {
    const result = await createReviewEligibility(baseInput, makeContainer());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('created');
  });

  it('UGC_SERVICE_URL 이 없어도 던지지 않는다', async () => {
    delete process.env.UGC_SERVICE_URL;

    const result = await createReviewEligibility(baseInput, makeContainer());

    expect(result.status).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('UGC_INTERNAL_KEY 가 없어도 던지지 않는다', async () => {
    delete process.env.UGC_INTERNAL_KEY;

    const result = await createReviewEligibility(baseInput, makeContainer());

    expect(result.status).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('almond_user_id 가 없어도 던지지 않는다', async () => {
    const container = makeContainer(async ({ entity }) =>
      entity === 'customer' ? { data: [{ metadata: {} }] } : { data: [] },
    );

    const result = await createReviewEligibility(baseInput, container);

    expect(result.status).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('주문 조회 자체가 터져도 던지지 않는다', async () => {
    const container = makeContainer(async () => {
      throw new Error('query.graph exploded');
    });

    const result = await createReviewEligibility(baseInput, container);

    expect(result.status).toBe('skipped');
  });

  it('ugc 가 401 을 돌려줘도 던지지 않는다', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' });

    const result = await createReviewEligibility(baseInput, makeContainer());

    expect(result.status).toBe('skipped');
  });

  it('ugc 로 가는 요청이 타임아웃·네트워크 오류로 터져도 던지지 않는다', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }));

    const result = await createReviewEligibility(baseInput, makeContainer());

    expect(result.status).toBe('skipped');
  });

  it('ugc 요청에 타임아웃이 «실제로» 걸려 있다', async () => {
    // 타임아웃이 없으면 ugc 가 매달릴 때 구매확정 워크플로가 같이 매달린다 — 결제 경로다.
    await createReviewEligibility(baseInput, makeContainer());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
