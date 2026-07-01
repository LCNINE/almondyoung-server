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
// inserted: billingEvents(CHARGE_CANCELED) 멱등 마커의 onConflictDoNothing.returning 결과.
//   비어있으면 = 같은 intent 취소가 이미 처리됨(재전달) → 해제하면 안 된다.
function makeCanceledHandler(opts: { released: unknown[]; inserted?: unknown[] }) {
  const setSpy = jest.fn();
  const insertValuesSpy = jest.fn();
  const update = jest.fn(() => ({
    set: (v: unknown) => {
      setSpy(v);
      return { where: () => ({ returning: () => Promise.resolve(opts.released) }) };
    },
  }));
  const insert = jest.fn(() => ({
    values: (v: unknown) => {
      insertValuesSpy(v);
      return { onConflictDoNothing: () => ({ returning: () => Promise.resolve(opts.inserted ?? [{ id: 'be1' }]) }) };
    },
  }));
  const tx = { update, insert };
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
  return { handler, setSpy, addEvent, insertValuesSpy };
}

describe('BillingOutcomeHandler.handleCanceled', () => {
  it('billingInProgress 선점을 해제하고 BILLING_CANCELED 감사 이벤트를 기록한다', async () => {
    const { handler, setSpy, addEvent } = makeCanceledHandler({ released: [{ userId: 'u1' }] });
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
    const { handler, addEvent } = makeCanceledHandler({ released: [] });
    await handler.handleCanceled('c1', 'intent-x');
    expect(addEvent).not.toHaveBeenCalled();
  });

  it('같은 intent 의 취소가 재전달되면(멱등 마커 충돌) 선점을 해제하지 않는다', async () => {
    // 마커 삽입이 0행 = 이 intent 취소는 이미 처리됨. 이후 새 청구가 billingInProgress 를 다시 잡았어도
    // 옛 intent 의 재전달 취소가 그 선점을 풀어선 안 된다.
    const { handler, setSpy, addEvent } = makeCanceledHandler({ released: [{ userId: 'u1' }], inserted: [] });
    await handler.handleCanceled('c1', 'intent-x');
    expect(setSpy).not.toHaveBeenCalled();
    expect(addEvent).not.toHaveBeenCalled();
  });
});

// handleFailure: 해지/종료된 계약의 in-flight 결제 실패는 error-code 무관하게 재청구(dunning)를 막아야 한다(Finding 1).
// 첫 select = 계약(userId/autoRenewal/recurringCancelledAt/status), 둘째 select = 기존 dunning row.
function makeFailureHandler(opts: {
  contract: { userId: string; autoRenewal: boolean; recurringCancelledAt: Date | null; status: string };
  dunning?: unknown;
}) {
  const setSpy = jest.fn();
  const deleteSpy = jest.fn();

  const selectBuilder = (limitResult: unknown[]) => {
    const b: Record<string, unknown> = {};
    b.from = () => b;
    b.innerJoin = () => b;
    b.leftJoin = () => b;
    b.where = () => b;
    b.orderBy = () => b;
    b.limit = () => Promise.resolve(limitResult);
    return b;
  };

  const select = jest
    .fn()
    .mockReturnValueOnce(selectBuilder([opts.contract])) // 계약
    .mockReturnValueOnce(selectBuilder(opts.dunning ? [opts.dunning] : [])); // dunning

  const insert = jest.fn(() => ({
    values: () => ({
      onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: 'be1' }]) }),
      returning: () => Promise.resolve([{ id: 'batch1' }]),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(undefined).then(res, rej),
    }),
  }));

  const update = jest.fn(() => ({
    set: (v: unknown) => {
      setSpy(v);
      return { where: () => Promise.resolve(undefined) };
    },
  }));
  const del = jest.fn(() => ({
    where: () => {
      deleteSpy();
      return Promise.resolve(undefined);
    },
  }));

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
  return { handler, insert, setSpy, deleteSpy };
}

describe('BillingOutcomeHandler.handleFailure — 해지/종료 계약', () => {
  it('정기결제 해지(autoRenewal=false) 계약의 일반 실패는 dunning 을 만들지 않고 선점·큐를 정리한다', async () => {
    const { handler, insert, setSpy, deleteSpy } = makeFailureHandler({
      contract: { userId: 'u1', autoRenewal: false, recurringCancelledAt: new Date(), status: 'ACTIVE' },
    });
    await handler.handleFailure('c1', 'INSUFFICIENT_BALANCE', '잔액 부족', 'intent-x');
    // billingEvents 멱등 마커 1회만 — dunning/eventBatches insert 가 있으면 안 된다.
    expect(insert).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ billingInProgress: false, billingStartedAt: null }));
    expect(deleteSpy).toHaveBeenCalled(); // 잔여 dunning 큐 제거
  });

  it('즉시취소(status=CANCELLED) 계약의 일반 실패도 dunning 을 만들지 않는다', async () => {
    const { handler, insert, deleteSpy } = makeFailureHandler({
      contract: { userId: 'u1', autoRenewal: true, recurringCancelledAt: null, status: 'CANCELLED' },
    });
    await handler.handleFailure('c1', 'INSUFFICIENT_BALANCE', '잔액 부족', 'intent-x');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalled();
  });

  it('활성 계약(autoRenewal=true, status=ACTIVE)의 일반 실패는 정상적으로 dunning 에 진입한다(회귀)', async () => {
    const { handler, insert, deleteSpy } = makeFailureHandler({
      contract: { userId: 'u1', autoRenewal: true, recurringCancelledAt: null, status: 'ACTIVE' },
    });
    await handler.handleFailure('c1', 'INSUFFICIENT_BALANCE', '잔액 부족', 'intent-x');
    // 마커 + dunning + BILLING_FAILED batch → insert 여러 번, dunning 삭제는 없음.
    expect(insert.mock.calls.length).toBeGreaterThan(1);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
