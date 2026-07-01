import { BillingOutcomeHandler } from './billing-outcome.handler';

// handleSuccess 의 계약 update 만 검증. drizzle 체인은 호출 순서대로 mock 반환값을 물려 흐름을 통과시키고,
// update().set() 인자를 캡처해 lastPaymentIntentId 동기화를 확인한다.
function makeHandler() {
  const setSpy = jest.fn();

  const selectBuilder = (limitResult: unknown[], awaitResult?: unknown[]) => {
    const b: Record<string, unknown> = {};
    b.from = () => b;
    b.innerJoin = () => b;
    b.leftJoin = () => b;
    b.where = () => b;
    b.orderBy = () => b;
    b.limit = () => Promise.resolve(limitResult);
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(awaitResult ?? []).then(res, rej);
    return b;
  };

  const insertBuilder = (returningResult: unknown[]) => ({
    values: () => ({
      onConflictDoNothing: () => ({ returning: () => Promise.resolve(returningResult) }),
      returning: () => Promise.resolve(returningResult),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(undefined).then(res, rej),
    }),
  });

  const contractRow = { userId: 'u1', durationDays: 30 };
  const entitlementRow = { id: 'ent1', tierId: 'tier1', startsAt: '2026-06-01', endsAt: '2026-08-01' };

  const select = jest
    .fn()
    .mockReturnValueOnce(selectBuilder([contractRow])) // getContractWithPlan → limit
    .mockReturnValueOnce(selectBuilder([], [{ count: 0 }])) // billingEvents count → await
    .mockReturnValueOnce(selectBuilder([entitlementRow])); // getActiveEntitlement → limit

  const insert = jest
    .fn()
    .mockReturnValueOnce(insertBuilder([{ id: 'be1' }])) // billingEvents (onConflictDoNothing.returning)
    .mockReturnValueOnce(insertBuilder([{ id: 'batch1' }])) // eventBatches (returning)
    .mockReturnValueOnce(insertBuilder([])); // subscriptionEntitlement (values awaited)

  const update = jest.fn(() => ({
    set: (v: unknown) => {
      setSpy(v);
      return { where: () => Promise.resolve(undefined) };
    },
  }));
  const del = jest.fn(() => ({ where: () => Promise.resolve(undefined) }));

  const tx = { select, insert, update, delete: del };
  const transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx));
  const dbService = { db: { transaction } };
  const contractEventManager = { addEvent: jest.fn().mockResolvedValue(undefined) };
  const membershipEventPublisher = { publishStatusChanged: jest.fn().mockResolvedValue(undefined) };

  const handler = new BillingOutcomeHandler(
    dbService as never,
    contractEventManager as never,
    membershipEventPublisher as never,
  );

  const contractSet = () => setSpy.mock.calls.map((c) => c[0]).find((v) => v && 'nextBillingDate' in v);
  return { handler, contractSet };
}

describe('BillingOutcomeHandler.handleSuccess', () => {
  it('정기결제 성공 시 계약의 lastPaymentIntentId 를 이번 결제 intent 로 갱신한다', async () => {
    const { handler, contractSet } = makeHandler();
    await handler.handleSuccess('c1', 1000, 'intent-new');
    expect(contractSet()).toMatchObject({ lastPaymentIntentId: 'intent-new' });
  });

  it('paymentIntentId 가 없으면(레거시 재전달) lastPaymentIntentId 를 null 로 덮어쓰지 않는다', async () => {
    const { handler, contractSet } = makeHandler();
    await handler.handleSuccess('c1', 1000, undefined);
    expect(contractSet()).not.toHaveProperty('lastPaymentIntentId');
  });
});

// handleCanceled: CMS 정산대기 intent 취소 시 billingInProgress 선점을 해제한다(Finding 2).
function makeCanceledHandler(releasedRows: unknown[]) {
  const setSpy = jest.fn();
  const update = jest.fn(() => ({
    set: (v: unknown) => {
      setSpy(v);
      return { where: () => ({ returning: () => Promise.resolve(releasedRows) }) };
    },
  }));
  const tx = { update };
  const transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx));
  const dbService = { db: { transaction } };
  const addEvent = jest.fn().mockResolvedValue(undefined);
  const contractEventManager = { addEvent };
  const membershipEventPublisher = { publishStatusChanged: jest.fn().mockResolvedValue(undefined) };
  const handler = new BillingOutcomeHandler(
    dbService as never,
    contractEventManager as never,
    membershipEventPublisher as never,
  );
  return { handler, setSpy, addEvent };
}

describe('BillingOutcomeHandler.handleCanceled', () => {
  it('billingInProgress 선점을 해제하고 BILLING_CANCELED 감사 이벤트를 기록한다', async () => {
    const { handler, setSpy, addEvent } = makeCanceledHandler([{ userId: 'u1' }]);
    await handler.handleCanceled('c1', 'intent-x');
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ billingInProgress: false, billingStartedAt: null }));
    expect(addEvent).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      'BILLING_CANCELED',
      expect.objectContaining({ paymentIntentId: 'intent-x' }),
      'SYSTEM',
      'u1',
    );
  });

  it('해제할 진행중 청구가 없으면(중복 전달/이미 처리) 감사 이벤트를 남기지 않는다', async () => {
    const { handler, addEvent } = makeCanceledHandler([]);
    await handler.handleCanceled('c1', 'intent-x');
    expect(addEvent).not.toHaveBeenCalled();
  });
});
