import { TossApproveService } from './toss-approve.service';
import { DeferredApprovalService } from './deferred-approval.service';
import { tossBrandPayCustomerKey } from '../providers/toss/toss-brandpay-customer-key';
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
    providerIdempotencyKey: `wallet:authorize:${CHARGE_ID}`,
    responsePayload: {},
    ...overrides,
  } as never;
}

function makeDb(intent: Record<string, unknown>, intentUpdates: unknown[] = []) {
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([intent]) }) }),
    }),
    update: () => ({
      set: (values: unknown) => {
        intentUpdates.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db } as never;
}

function makeTossContext(
  intentMetadata: Record<string, unknown>,
  charge = makeCharge(),
  confirmResult: {
    ok: boolean;
    data?: Record<string, unknown> & { paymentKey: string };
    error?: { code: string; message: string };
  } = {
    ok: true,
    data: { paymentKey: 'pk_live_1' },
  },
) {
  const intent = {
    id: 'intent-1',
    status: 'REQUIRES_ACTION',
    userId: 'u1',
    currency: 'KRW',
    payableAmount: 10000,
    metadata: intentMetadata,
  };
  const chargesService = {
    findActiveByIntentAndOperation: jest.fn().mockResolvedValue(charge),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
  const stateTransitionService = { transitionIntent: jest.fn().mockResolvedValue(undefined) };
  const autoCaptureService = { attemptAutoCapture: jest.fn().mockResolvedValue(undefined) };
  const tossApi = {
    confirmPayment: jest.fn().mockResolvedValue(confirmResult),
    confirmBrandPayPayment: jest.fn().mockResolvedValue(confirmResult),
    cancelPayment: jest.fn().mockResolvedValue({ ok: true, data: {} }),
  };
  const cashReceiptsService = { issue: jest.fn() };
  const bankTransferProvider = { getUserMethods: jest.fn().mockResolvedValue([{ id: 'pm-bank' }]) };
  const intentUpdates: unknown[] = [];

  const service = new TossApproveService(
    makeDb(intent, intentUpdates),
    chargesService as never,
    autoCaptureService as never,
    stateTransitionService as never,
    tossApi as never,
    cashReceiptsService as never,
    bankTransferProvider as never,
  );

  return {
    service,
    chargesService,
    tossApi,
    autoCaptureService,
    stateTransitionService,
    bankTransferProvider,
    intentUpdates,
    intent,
  };
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

  it('브랜드페이 고객 키와 결제 유형을 적재하고 전용 API로 최종 승인한다', async () => {
    const ctx = makeTossContext({ approvalMode: 'DEFERRED' });
    await ctx.service.approve('intent-1', 'pk_brandpay', ORDER_ID, 10000, 'corr-1', 'BRANDPAY');
    expect(ctx.tossApi.confirmBrandPayPayment).not.toHaveBeenCalled();
    const extra = ctx.chargesService.updateStatus.mock.calls[0][2];
    const staged = readStagedApproval(makeCharge({ responsePayload: extra.responsePayload }));
    expect(staged).toEqual(
      expect.objectContaining({ paymentType: 'BRANDPAY', customerKey: tossBrandPayCustomerKey('u1') }),
    );
    await ctx.service.confirmStaged(makeCharge(), staged!, 'corr-2');
    expect(ctx.tossApi.confirmBrandPayPayment).toHaveBeenCalledWith(
      'pk_brandpay',
      10000,
      ORDER_ID,
      tossBrandPayCustomerKey('u1'),
    );
    expect(ctx.tossApi.confirmPayment).not.toHaveBeenCalled();
  });

  it('즉시 승인에서도 브랜드페이 전용 API를 호출한다', async () => {
    const ctx = makeTossContext({});
    await ctx.service.approve('intent-1', 'pk_brandpay', ORDER_ID, 10000, 'corr-1', 'BRANDPAY');
    expect(ctx.tossApi.confirmBrandPayPayment).toHaveBeenCalledWith(
      'pk_brandpay',
      10000,
      ORDER_ID,
      tossBrandPayCustomerKey('u1'),
    );
    expect(ctx.tossApi.confirmPayment).not.toHaveBeenCalled();
  });

  it('고객 키가 빠진 브랜드페이 적재 데이터는 거부한다', () => {
    expect(
      readStagedApproval(
        makeCharge({
          responsePayload: {
            stagedApproval: {
              provider: 'TOSS',
              providerToken: 'pk_brandpay',
              orderId: ORDER_ID,
              amount: 10000,
              paymentType: 'BRANDPAY',
            },
          },
        }),
      ),
    ).toBeNull();
  });

  it('금액이 charge 와 다르면 적재하지 않는다', async () => {
    const ctx = makeTossContext({ approvalMode: 'DEFERRED' });

    await expect(ctx.service.approve('intent-1', 'pk_live_1', ORDER_ID, 9999, 'corr-1')).rejects.toThrow();
    expect(ctx.chargesService.updateStatus).not.toHaveBeenCalled();
  });

  it('지연 승인 표식이 없는 intent 는 기존대로 즉시 승인한다', async () => {
    const ctx = makeTossContext({});

    await ctx.service.approve('intent-1', 'pk_live_1', ORDER_ID, 10000, 'corr-1');

    expect(ctx.tossApi.confirmPayment).toHaveBeenCalledWith('pk_live_1', 10000, ORDER_ID, false);
  });
});

describe('deferred approval — confirmStaged', () => {
  const staged = {
    provider: 'TOSS' as const,
    providerToken: 'pk_live_1',
    orderId: ORDER_ID,
    amount: 10000,
    stagedAt: new Date(0).toISOString(),
  };

  it('적재된 파라미터로 승인하고 AUTHORIZED 로 올린 뒤 캡처를 태운다', async () => {
    const ctx = makeTossContext({ approvalMode: 'DEFERRED' });

    await ctx.service.confirmStaged(makeCharge(), staged, 'corr-1');

    expect(ctx.tossApi.confirmPayment).toHaveBeenCalledWith('pk_live_1', 10000, ORDER_ID, false);
    expect(ctx.stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'AUTHORIZED',
      expect.anything(),
      undefined,
      expect.anything(),
    );
    expect(ctx.autoCaptureService.attemptAutoCapture).toHaveBeenCalled();
  });

  it('PG 승인 거절이면 charge 를 FAILED, intent 를 CREATED 로 되돌리고 throw 한다', async () => {
    // throw 해야 호출자(Medusa completeCartWorkflow)가 주문·재고예약을 롤백한다.
    // intent 를 CREATED 로 되돌려야 고객이 같은 결제 세션으로 재시도할 수 있다.
    const ctx = makeTossContext({ approvalMode: 'DEFERRED' }, makeCharge(), {
      ok: false,
      error: { code: 'REJECT_CARD_COMPANY', message: '카드사 승인 거절' },
    });

    await expect(ctx.service.confirmStaged(makeCharge(), staged, 'corr-1')).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'REJECT_CARD_COMPANY' }),
    });

    expect(ctx.chargesService.updateStatus).toHaveBeenCalledWith(
      CHARGE_ID,
      'FAILED',
      expect.objectContaining({ errorCode: 'REJECT_CARD_COMPANY' }),
      expect.anything(),
    );
    expect(ctx.stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'CREATED',
      expect.anything(),
      undefined,
      expect.anything(),
    );
    expect(ctx.autoCaptureService.attemptAutoCapture).not.toHaveBeenCalled();
  });
});

const WIDGET_CHARGE = makeCharge({
  responsePayload: { nextAction: { type: 'TOSS_CHECKOUT', checkoutMode: 'WIDGET' } },
});
const VA_CONFIRM = {
  ok: true,
  data: {
    paymentKey: 'pk_va',
    status: 'WAITING_FOR_DEPOSIT',
    secret: 'va-secret',
    virtualAccount: {
      accountType: '일반',
      accountNumber: '12345678901234',
      bankCode: '20',
      customerName: '홍길동',
      dueDate: '2026-10-24T10:00:00+09:00',
    },
  },
};

describe('widget virtual account', () => {
  it('가상계좌 신호면 지연 승인 intent 라도 바로 승인해 무통장 입금대기로 보낸다', async () => {
    const ctx = makeTossContext({ approvalMode: 'DEFERRED', customerEmail: 'a@b.com' }, WIDGET_CHARGE, VA_CONFIRM);

    await ctx.service.approve('intent-1', 'pk_va', ORDER_ID, 10000, 'corr-1', 'NORMAL', 'VIRTUAL_ACCOUNT');

    expect(ctx.tossApi.confirmPayment).toHaveBeenCalledWith('pk_va', 10000, ORDER_ID, true);
    expect(ctx.bankTransferProvider.getUserMethods).toHaveBeenCalledWith('u1');
    const [, status, extra] = ctx.chargesService.updateStatus.mock.calls[0];
    expect(status).toBe('REQUIRES_ACTION');
    expect(extra).toEqual(
      expect.objectContaining({
        paymentMethodId: 'pm-bank',
        providerTransactionId: 'pk_va',
        responsePayload: expect.objectContaining({
          paymentKey: 'pk_va',
          secret: 'va-secret',
          nextAction: expect.objectContaining({
            type: 'BANK_TRANSFER_PENDING',
            checkoutMode: 'WIDGET',
            bankName: '우리은행',
            accountNumber: '12345678901234',
            amount: 10000,
          }),
        }),
      }),
    );
    expect(ctx.stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'AWAITING_DEPOSIT',
      expect.objectContaining({
        outboxEvent: expect.objectContaining({ eventType: 'payment.intent.awaiting_deposit' }),
      }),
      undefined,
      expect.anything(),
    );
    expect(ctx.intentUpdates).toContainEqual(
      expect.objectContaining({
        paymentMethodId: 'pm-bank',
        actionExpiresAt: null,
        expiresAt: new Date('2026-10-24T10:00:00+09:00'),
      }),
    );
    // 입금 전이므로 승인·캡처로 가면 안 된다.
    expect(ctx.autoCaptureService.attemptAutoCapture).not.toHaveBeenCalled();
  });

  it('신호가 없어도 즉시 승인 intent 의 가상계좌 응답은 입금대기로 보낸다', async () => {
    const ctx = makeTossContext({}, WIDGET_CHARGE, VA_CONFIRM);

    await ctx.service.approve('intent-1', 'pk_va', ORDER_ID, 10000, 'corr-1');

    expect(ctx.stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'AWAITING_DEPOSIT',
      expect.anything(),
      undefined,
      expect.anything(),
    );
    expect(ctx.autoCaptureService.attemptAutoCapture).not.toHaveBeenCalled();
  });

  it('지연 승인 안에서 가상계좌가 나오면 계좌를 닫고 실패시켜 주문을 롤백하게 한다', async () => {
    const ctx = makeTossContext({ approvalMode: 'DEFERRED' }, WIDGET_CHARGE, VA_CONFIRM);
    const staged = {
      provider: 'TOSS' as const,
      providerToken: 'pk_va',
      orderId: ORDER_ID,
      amount: 10000,
      stagedAt: new Date(0).toISOString(),
    };

    await expect(ctx.service.confirmStaged(WIDGET_CHARGE, staged, 'corr-1')).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'VIRTUAL_ACCOUNT_NOT_DEFERRABLE' }),
    });

    expect(ctx.tossApi.cancelPayment).toHaveBeenCalledWith(
      'pk_va',
      expect.any(String),
      undefined,
      expect.any(String),
      undefined,
      true,
    );
    expect(ctx.stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'CREATED',
      expect.anything(),
      undefined,
      expect.anything(),
    );
    expect(ctx.stateTransitionService.transitionIntent).not.toHaveBeenCalledWith(
      'intent-1',
      'AWAITING_DEPOSIT',
      expect.anything(),
      undefined,
      expect.anything(),
    );
    expect(ctx.autoCaptureService.attemptAutoCapture).not.toHaveBeenCalled();
  });

  it('계좌를 못 닫으면 실패로 확정하지 않고 기존 무통장 입금대기로 넘긴다', async () => {
    const staged = {
      provider: 'TOSS' as const,
      providerToken: 'pk_va',
      orderId: ORDER_ID,
      amount: 10000,
      stagedAt: new Date(0).toISOString(),
    };
    const stagedCharge = makeCharge({
      responsePayload: { nextAction: { type: 'TOSS_CHECKOUT', checkoutMode: 'WIDGET' }, stagedApproval: staged },
    });
    const ctx = makeTossContext({ approvalMode: 'DEFERRED' }, stagedCharge, VA_CONFIRM);
    ctx.tossApi.cancelPayment.mockResolvedValue({ ok: false, error: { code: 'PROVIDER_ERROR', message: 'x' } });

    await expect(ctx.service.confirmStaged(stagedCharge, staged, 'corr-1')).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'VIRTUAL_ACCOUNT_NOT_DEFERRABLE' }),
    });

    // FAILED 면 입금 웹훅이 무시되고, REQUIRES_ACTION 이면 재결제가 계좌 폐쇄 없이 charge 를 취소한다.
    expect(ctx.chargesService.updateStatus).not.toHaveBeenCalledWith(
      CHARGE_ID,
      'FAILED',
      expect.anything(),
      expect.anything(),
    );
    expect(ctx.stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'AWAITING_DEPOSIT',
      expect.anything(),
      undefined,
      expect.anything(),
    );
    const [, status, extra] = ctx.chargesService.updateStatus.mock.calls[0];
    expect(status).toBe('REQUIRES_ACTION');
    expect(extra).toEqual(expect.objectContaining({ paymentMethodId: 'pm-bank', providerTransactionId: 'pk_va' }));
    // 적재된 승인이 남으면 finalize 재시도가 이미 발급된 계좌를 다시 승인하려 한다.
    expect(extra.responsePayload).not.toHaveProperty('stagedApproval');
  });

  it('입금대기 반영이 거부되면(승인 중 만료·취소) 발급된 계좌를 닫는다', async () => {
    const ctx = makeTossContext({}, WIDGET_CHARGE, VA_CONFIRM);
    ctx.stateTransitionService.transitionIntent.mockRejectedValue(new Error('INVALID_TRANSITION'));

    await expect(ctx.service.approve('intent-1', 'pk_va', ORDER_ID, 10000, 'corr-1')).rejects.toThrow(
      'INVALID_TRANSITION',
    );

    expect(ctx.tossApi.cancelPayment).toHaveBeenCalledWith(
      'pk_va',
      expect.any(String),
      undefined,
      expect.any(String),
      undefined,
      true,
    );
  });

  it('입금대기 반영이 거부되고 계좌도 못 닫으면 결제 키와 무통장 분류를 charge 에 남긴다', async () => {
    const ctx = makeTossContext({}, WIDGET_CHARGE, VA_CONFIRM);
    ctx.stateTransitionService.transitionIntent.mockRejectedValue(new Error('INVALID_TRANSITION'));
    // 전송 오류로 닫혔는지 모르는 경우도 열린 계좌로 다룬다.
    ctx.tossApi.cancelPayment.mockRejectedValue(new Error('ECONNRESET'));

    await expect(ctx.service.approve('intent-1', 'pk_va', ORDER_ID, 10000, 'corr-1')).rejects.toThrow(
      'INVALID_TRANSITION',
    );

    // 정리 경로가 무통장으로 보고 계좌를 닫으려면 결제 키·결제수단·위젯 표식이 남아 있어야 한다. 상태는 안 바꾼다.
    const recovered = ctx.intentUpdates.at(-1) as Record<string, unknown>;
    expect(recovered).toEqual(
      expect.objectContaining({
        paymentMethodId: 'pm-bank',
        providerTransactionId: 'pk_va',
        responsePayload: expect.objectContaining({
          paymentKey: 'pk_va',
          nextAction: expect.objectContaining({ checkoutMode: 'WIDGET' }),
        }),
      }),
    );
    expect(recovered).not.toHaveProperty('status');
  });

  it('가상계좌 신호인데 실제로 카드가 승인되면 승인을 되돌리고 실패시킨다', async () => {
    const ctx = makeTossContext({ approvalMode: 'DEFERRED' }, WIDGET_CHARGE, {
      ok: true,
      data: { paymentKey: 'pk_card', status: 'DONE' },
    });

    await expect(
      ctx.service.approve('intent-1', 'pk_card', ORDER_ID, 10000, 'corr-1', 'NORMAL', 'VIRTUAL_ACCOUNT'),
    ).rejects.toMatchObject({ response: expect.objectContaining({ error: 'PAYMENT_METHOD_MISMATCH' }) });

    expect(ctx.tossApi.cancelPayment).toHaveBeenCalledWith(
      'pk_card',
      expect.any(String),
      undefined,
      expect.any(String),
      undefined,
      true,
    );
    expect(ctx.autoCaptureService.attemptAutoCapture).not.toHaveBeenCalled();
  });

  it('가상계좌 신호가 있어도 금액이 charge 와 다르면 승인하지 않는다', async () => {
    const ctx = makeTossContext({ approvalMode: 'DEFERRED' }, WIDGET_CHARGE, VA_CONFIRM);

    await expect(
      ctx.service.approve('intent-1', 'pk_other', ORDER_ID, 100, 'corr-1', 'NORMAL', 'VIRTUAL_ACCOUNT'),
    ).rejects.toMatchObject({ response: expect.objectContaining({ error: 'TOSS_AMOUNT_MISMATCH' }) });
    expect(ctx.tossApi.confirmPayment).not.toHaveBeenCalled();
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
    const service = new DeferredApprovalService(makeDb(intent), chargesService as never, tossApproveService as never);
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
