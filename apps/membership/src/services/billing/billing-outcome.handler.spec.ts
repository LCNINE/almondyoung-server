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

// handleCanceled: 활성 자동갱신 계약의 CMS 정산대기 취소는 dunning 을 생성/증가시켜 다음 재시도가 새
// 멱등키로 나가게 한다(Finding 1). 해지/종료 계약은 재청구하지 않는다.
// released: billingInProgress 해제 update().where().returning() 결과(계약 가드 필드 포함).
// inserted: CHARGE_CANCELED 멱등 마커 결과. 비어있으면 = 재전달 → 해제/재청구 안 함.
function makeCanceledHandler(opts: {
  released: Array<{ userId: string; autoRenewal?: boolean; recurringCancelledAt?: Date | null; status?: string }>;
  inserted?: unknown[];
  dunning?: { id: string; attempts: number; maxAttempts: number } | null;
}) {
  const setSpy = jest.fn();
  const insertValuesSpy = jest.fn();
  const deleteSpy = jest.fn();

  const where = () => ({
    returning: () => Promise.resolve(opts.released),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(undefined).then(res, rej),
  });
  const update = jest.fn(() => ({
    set: (v: unknown) => {
      setSpy(v);
      return { where };
    },
  }));

  const selectBuilder = (limitResult: unknown[]) => {
    const b: Record<string, unknown> = {};
    b.from = () => b;
    b.where = () => b;
    b.limit = () => Promise.resolve(limitResult);
    return b;
  };
  const select = jest.fn(() => selectBuilder(opts.dunning ? [opts.dunning] : []));

  const insert = jest.fn(() => ({
    values: (v: unknown) => {
      insertValuesSpy(v);
      return {
        onConflictDoNothing: () => ({ returning: () => Promise.resolve(opts.inserted ?? [{ id: 'be1' }]) }),
        returning: () => Promise.resolve([{ id: 'batch1' }]),
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(undefined).then(res, rej),
      };
    },
  }));

  const del = jest.fn(() => ({
    where: () => {
      deleteSpy();
      return Promise.resolve(undefined);
    },
  }));

  const tx = { update, insert, select, delete: del };
  const transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx));
  const dbService = { db: { transaction } };
  const addEvent = jest.fn().mockResolvedValue(undefined);
  const contractEventManager = { addEvent };
  const publishStatusChanged = jest.fn().mockResolvedValue(undefined);
  const membershipEventPublisher = { publishStatusChanged };
  const handler = new BillingOutcomeHandler(
    dbService as never,
    contractEventManager as never,
    membershipEventPublisher as never,
  );

  const findInsert = (pred: (v: Record<string, unknown>) => boolean) =>
    insertValuesSpy.mock.calls.map((c) => c[0] as Record<string, unknown>).find((v) => v && pred(v));
  const findSet = (pred: (v: Record<string, unknown>) => boolean) =>
    setSpy.mock.calls.map((c) => c[0] as Record<string, unknown>).find((v) => v && pred(v));
  return { handler, setSpy, addEvent, insertValuesSpy, deleteSpy, publishStatusChanged, findInsert, findSet };
}

describe('BillingOutcomeHandler.handleCanceled', () => {
  const ACTIVE = { userId: 'u1', autoRenewal: true, recurringCancelledAt: null, status: 'ACTIVE' };

  it('활성 자동갱신 계약 취소 → 선점 해제 + BILLING_CANCELED + dunning 생성(attempts=1)', async () => {
    const { handler, setSpy, addEvent, findInsert } = makeCanceledHandler({ released: [ACTIVE], dunning: null });
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
    // 새 멱등키 확보용 dunning 생성 (attempts=1)
    expect(findInsert((v) => 'attempts' in v && 'maxAttempts' in v)).toMatchObject({ contractId: 'c1', attempts: 1 });
  });

  it('기존 dunning(attempts=1) 있는 활성 계약 취소 → attempts=2 로 증가', async () => {
    const { handler, findSet } = makeCanceledHandler({
      released: [ACTIVE],
      dunning: { id: 'd1', attempts: 1, maxAttempts: 3 },
    });
    await handler.handleCanceled('c1', 'intent-x');
    // dunning update set: attempts 만 있고 billingInProgress 는 없는 set 호출을 찾는다.
    expect(findSet((v) => 'attempts' in v && !('billingInProgress' in v))).toMatchObject({ attempts: 2 });
  });

  it('자동갱신 off 계약 취소 → dunning 생성 안 함 + 큐 정리(delete)', async () => {
    const { handler, insertValuesSpy, deleteSpy } = makeCanceledHandler({
      released: [{ userId: 'u1', autoRenewal: false, recurringCancelledAt: new Date(), status: 'ACTIVE' }],
      dunning: null,
    });
    await handler.handleCanceled('c1', 'intent-x');
    // 마커 insert 1회만 — dunning insert 없음.
    const dunningInsert = insertValuesSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((v) => v && 'attempts' in v);
    expect(dunningInsert).toBeUndefined();
    expect(deleteSpy).toHaveBeenCalled();
  });

  it('dunning 상한 도달 계약 취소 → 해지 + CANCELLED 상태 발행', async () => {
    const { handler, publishStatusChanged } = makeCanceledHandler({
      released: [ACTIVE],
      dunning: { id: 'd1', attempts: 3, maxAttempts: 3 },
    });
    await handler.handleCanceled('c1', 'intent-x');
    expect(publishStatusChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'CANCELLED', contractId: 'c1' }));
  });

  it('해제할 진행중 청구가 없으면(중복/이미 처리) 감사 이벤트를 남기지 않는다', async () => {
    const { handler, addEvent } = makeCanceledHandler({ released: [] });
    await handler.handleCanceled('c1', 'intent-x');
    expect(addEvent).not.toHaveBeenCalled();
  });

  it('같은 intent 취소 재전달(멱등 마커 충돌)이면 선점을 해제하지 않는다', async () => {
    const { handler, setSpy, addEvent } = makeCanceledHandler({ released: [ACTIVE], inserted: [] });
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
