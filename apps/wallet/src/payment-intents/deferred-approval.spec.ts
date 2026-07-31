import { TossApproveService } from './toss-approve.service';
import { DeferredApprovalService } from './deferred-approval.service';
import { readStagedApproval } from './deferred-approval';

// 지연 승인(deferred approval): Medusa 체크아웃 intent 는 결제창 완료 시점에 PG 승인을 하지 않고
// 파라미터만 적재하고, 주문 생성 + 재고예약이 끝난 뒤 finalize 에서 비로소 승인한다.

const CHARGE_ID = '11111111-2222-3333-4444-555555555555';
const ORDER_ID = CHARGE_ID.replace(/-/g, '');

function makeCharge(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CHARGE_ID,
    intentId: 'intent-1',
    paymentMethodId: 'pm-1',
    amount: 10000,
    currency: 'KRW',
    operation: 'AUTHORIZE',
    status: 'REQUIRES_ACTION',
    responsePayload: {},
    ...overrides,
  } as never;
}

function makeDb(intent: Record<string, unknown>) {
  return {
    db: {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([intent]) }) }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    },
  } as never;
}

function makeTossContext(
  intentMetadata: Record<string, unknown>,
  charge = makeCharge(),
  confirmResult: { ok: boolean; data?: { paymentKey: string }; error?: { code: string; message: string } } = {
    ok: true,
    data: { paymentKey: 'pk_live_1' },
  },
) {
  const intent = { id: 'intent-1', status: 'REQUIRES_ACTION', userId: 'u1', currency: 'KRW', payableAmount: 10000, metadata: intentMetadata };
  const chargesService = {
    findActiveByIntentAndOperation: jest.fn().mockResolvedValue(charge),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
  const stateTransitionService = { transitionIntent: jest.fn().mockResolvedValue(undefined) };
  const autoCaptureService = { attemptAutoCapture: jest.fn().mockResolvedValue(undefined) };
  const tossApi = { confirmPayment: jest.fn().mockResolvedValue(confirmResult) };
  const cashReceiptsService = { issue: jest.fn() };

  const service = new TossApproveService(
    makeDb(intent),
    chargesService as never,
    autoCaptureService as never,
    stateTransitionService as never,
    tossApi as never,
    cashReceiptsService as never,
  );

  return { service, chargesService, tossApi, autoCaptureService, stateTransitionService, intent };
}

describe('deferred approval — staging', () => {
  it('결제창 완료 시 승인 API 를 부르지 않고 파라미터만 적재한다', async () => {
    const ctx = makeTossContext({ approvalMode: 'DEFERRED' });

    await ctx.service.approve('intent-1', 'pk_live_1', ORDER_ID, 10000, 'corr-1');

    expect(ctx.tossApi.confirmPayment).not.toHaveBeenCalled();
    expect(ctx.autoCaptureService.attemptAutoCapture).not.toHaveBeenCalled();

    const [, status, extra] = ctx.chargesService.updateStatus.mock.calls[0];
    expect(status).toBe('REQUIRES_ACTION');
    const staged = readStagedApproval(makeCharge({ responsePayload: extra.responsePayload }));
    expect(staged).toEqual(
      expect.objectContaining({ provider: 'TOSS', providerToken: 'pk_live_1', orderId: ORDER_ID, amount: 10000 }),
    );
    // 미승인 토큰이 providerTransactionId 로 새어나가면 취소/환불이 잘못 시도된다.
    expect(extra.providerTransactionId).toBeUndefined();
  });

  it('금액이 charge 와 다르면 적재하지 않는다', async () => {
    const ctx = makeTossContext({ approvalMode: 'DEFERRED' });

    await expect(ctx.service.approve('intent-1', 'pk_live_1', ORDER_ID, 9999, 'corr-1')).rejects.toThrow();
    expect(ctx.chargesService.updateStatus).not.toHaveBeenCalled();
  });

  it('지연 승인 표식이 없는 intent 는 기존대로 즉시 승인한다', async () => {
    const ctx = makeTossContext({});

    await ctx.service.approve('intent-1', 'pk_live_1', ORDER_ID, 10000, 'corr-1');

    expect(ctx.tossApi.confirmPayment).toHaveBeenCalledWith('pk_live_1', 10000, ORDER_ID);
  });
});

describe('deferred approval — finalize', () => {
  function makeFinalizeContext(
    intentStatus: string,
    charge: unknown,
    metadata: Record<string, unknown> = { approvalMode: 'DEFERRED' },
  ) {
    const intent = { id: 'intent-1', status: intentStatus, metadata };
    const chargesService = { findActiveByIntentAndOperation: jest.fn().mockResolvedValue(charge) };
    const tossApproveService = { confirmStaged: jest.fn().mockResolvedValue(undefined) };
    const service = new DeferredApprovalService(
      makeDb(intent),
      chargesService as never,
      tossApproveService as never,
    );
    return { service, tossApproveService };
  }

  const stagedCharge = makeCharge({
    responsePayload: {
      stagedApproval: {
        provider: 'TOSS',
        providerToken: 'pk_live_1',
        orderId: ORDER_ID,
        amount: 10000,
        stagedAt: new Date(0).toISOString(),
      },
    },
  });

  it('적재된 승인을 실제 PG 승인으로 확정한다', async () => {
    const ctx = makeFinalizeContext('REQUIRES_ACTION', stagedCharge);

    await ctx.service.finalize('intent-1', 'corr-1');

    expect(ctx.tossApproveService.confirmStaged).toHaveBeenCalledWith(
      stagedCharge,
      expect.objectContaining({ providerToken: 'pk_live_1', amount: 10000 }),
      'corr-1',
    );
  });

  it('이미 승인된 intent 는 멱등 no-op', async () => {
    const ctx = makeFinalizeContext('CAPTURED', stagedCharge);

    await expect(ctx.service.finalize('intent-1', 'corr-1')).resolves.toEqual({ status: 'CAPTURED' });
    expect(ctx.tossApproveService.confirmStaged).not.toHaveBeenCalled();
  });

  it('적재된 승인이 없으면 409 로 알려 호출자가 주문을 롤백하게 한다', async () => {
    const ctx = makeFinalizeContext('REQUIRES_ACTION', makeCharge());

    await expect(ctx.service.finalize('intent-1', 'corr-1')).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'NO_STAGED_APPROVAL' }),
    });
  });
});
