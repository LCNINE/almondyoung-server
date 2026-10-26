import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CashReceiptsService } from './cash-receipts.service';
import { charges, refunds } from '../schema';

// 구현의 findIntentOrThrow / listByIntent 가 UUID_RE 로 형식을 먼저 검사한다.
// 비-UUID 를 쓰면 모든 가드 테스트가 본론에 닿기 전에 NOT_FOUND 로 튕긴다.
// 재현 가능하도록 랜덤 생성 대신 고정 리터럴을 쓴다.
const INTENT_ID = '11111111-1111-4111-8111-111111111111';
const CHARGE_ID = '22222222-2222-4222-8222-222222222222';
const PM_ID = 'pm-001';
const USER_ID = 'user-001';

function makeIntent(overrides: Partial<{ userId: string; status: string }> = {}) {
  return {
    id: INTENT_ID,
    userId: overrides.userId ?? USER_ID,
    status: overrides.status ?? 'SUCCEEDED',
    payableAmount: 10000,
    currency: 'KRW',
  };
}

type ChargeOverrides = Partial<{
  id: string;
  amount: number;
  operation: string;
  requestPayload: Record<string, unknown> | null;
  responsePayload: unknown;
  providerTransactionId: string | null;
}>;

function makeCharge(overrides: ChargeOverrides = {}) {
  return {
    id: overrides.id ?? CHARGE_ID,
    operation: overrides.operation ?? 'AUTHORIZE',
    requestPayload: overrides.requestPayload ?? null,
    intentId: INTENT_ID,
    paymentMethodId: PM_ID,
    amount: overrides.amount ?? 10000,
    currency: 'KRW',
    responsePayload: overrides.responsePayload ?? null,
    providerTransactionId: overrides.providerTransactionId ?? null,
  };
}

function makeReceipt(
  overrides: Partial<{
    amount: number;
    canceledAmount: number;
    status: string;
    requestPayload: Record<string, unknown> | null;
  }> = {},
) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    chargeId: CHARGE_ID,
    intentId: INTENT_ID,
    amount: overrides.amount ?? 10000,
    canceledAmount: overrides.canceledAmount ?? 0,
    status: overrides.status ?? 'ISSUED',
    receiptKey: 'rk-001',
    canceledAt: null,
    requestPayload: overrides.requestPayload ?? null,
  };
}

/**
 * db.select() 는 호출 순서대로 selectQueue 의 결과를 반환한다 (limit/orderBy 공통).
 * issue() 의 select 순서: 1) findIntentOrThrow  2) findActiveByCharges  3) buildOrderName(items)
 * cancelForRefund() 의 select 순서: 1) findActiveByCharges
 * 짝 CAPTURE 조회(charges)·환불 합계(refunds)는 큐와 따로 opts.captures / opts.succeededRefunds 로 준다.
 */
function makeContext(
  opts: {
    selectQueue?: unknown[][];
    refundableCharges?: ReturnType<typeof makeCharge>[];
    methodType?: string;
    tossIssue?: { ok: boolean; data?: any; error?: any };
    tossCancel?: { ok: boolean; data?: any; error?: any; statusCode?: number };
    // 취소 호출마다 다른 결과 — Error 면 throw (응답 끊김)
    tossCancelByCall?: Array<{ ok: boolean; data?: any; error?: any; statusCode?: number } | Error>;
    tossPayment?: { ok: boolean; data?: any; error?: any };
    chargeById?: ReturnType<typeof makeCharge>;
    succeededRefunds?: Array<{ amount: number }>;
    captures?: ReturnType<typeof makeCharge>[];
    // 잠그는 조회(.for('update'))가 돌려줄 영수증. 갱신이 이 객체에 그대로 반영된다 — 세 걸음 취소를 따라가려고
    receipt?: ReturnType<typeof makeReceipt>;
    // 환불 합계 조회마다 다른 값을 돌려줄 때 — 앞에서부터 하나씩 쓰고, 다 쓰면 succeededRefunds
    refundsByCall?: Array<Array<{ amount: number }>>;
  } = {},
) {
  const selectQueue = [...(opts.selectQueue ?? [])];
  const updateCalls: Array<Record<string, unknown>> = [];
  const resultPromise = () => Promise.resolve(selectQueue.shift() ?? []);
  const refundsByCall = [...(opts.refundsByCall ?? [])];
  // 잠그는 조회는 opts.receipt 가 있으면 그 현재 상태를, 없으면 큐를 돌려준다. 큐는 await 될 때만 꺼낸다.
  const lockable = () => ({
    then: (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) =>
      resultPromise().then(resolve, reject),
    for: () => (opts.receipt ? Promise.resolve([{ ...opts.receipt }]) : resultPromise()),
  });

  const db = {
    db: {
      select: jest.fn().mockImplementation(() => ({
        // 환불 합계·짝 CAPTURE 조회는 selectQueue 와 따로 둔다 — 기존 가드 테스트의 조회 순서를 흔들지 않게
        from: (table: unknown) =>
          table === refunds
            ? { where: () => Promise.resolve(refundsByCall.shift() ?? opts.succeededRefunds ?? []) }
            : table === charges
              ? { where: () => Promise.resolve(opts.captures ?? []) }
              : {
                  where: () => ({
                    limit: lockable,
                    orderBy: () => {
                      const p = resultPromise();
                      return Object.assign(p, { limit: () => p });
                    },
                  }),
                },
      })),
      insert: jest.fn().mockImplementation(() => ({
        values: (vals: any) => ({ returning: () => Promise.resolve([{ id: 'cr-new', ...vals }]) }),
      })),
      update: jest.fn().mockImplementation(() => ({
        set: (vals: Record<string, unknown>) => ({
          where: () => {
            updateCalls.push(vals);
            if (opts.receipt) Object.assign(opts.receipt, vals);
            return Promise.resolve();
          },
        }),
      })),
    },
    // 트랜잭션 안에서도 같은 가짜 db 를 쓴다
    run: (fn: (tx: unknown) => Promise<unknown>) => fn(db.db),
  };

  const chargesService = {
    findRefundableByIntent: jest.fn().mockResolvedValue(opts.refundableCharges ?? [makeCharge()]),
    findById: jest.fn().mockResolvedValue(opts.chargeById ?? makeCharge()),
  };
  const paymentMethodsService = {
    findById: jest.fn().mockResolvedValue({ id: PM_ID, type: opts.methodType ?? 'BANK_TRANSFER' }),
  };
  const tossApiClient = {
    issueCashReceipt: jest.fn().mockResolvedValue(opts.tossIssue ?? { ok: true, data: {} }),
    cancelCashReceipt: jest.fn<Promise<unknown>, [string, number?, string?]>(),
    getPayment: jest.fn().mockResolvedValue(opts.tossPayment ?? { ok: true, data: { cashReceipt: null } }),
  };

  tossApiClient.cancelCashReceipt.mockResolvedValue(opts.tossCancel ?? { ok: true, data: {} });
  for (const result of opts.tossCancelByCall ?? []) {
    if (result instanceof Error) tossApiClient.cancelCashReceipt.mockRejectedValueOnce(result);
    else tossApiClient.cancelCashReceipt.mockResolvedValueOnce(result);
  }

  const service = new CashReceiptsService(
    db as any,
    chargesService as any,
    paymentMethodsService as any,
    tossApiClient as any,
  );
  return { service, tossApiClient, updateCalls, receipt: opts.receipt };
}

function pendingCancelOf(amount: number, requestedAt = new Date().toISOString()) {
  return { amount, idempotencyKey: 'k-pending', requestedAt };
}

const DTO = { intentId: INTENT_ID, type: '소득공제' as const, customerIdentityNumber: '01012345678' };

describe('CashReceiptsService', () => {
  describe('issue() 가드', () => {
    it('다른 유저의 인텐트면 NotFound', async () => {
      const { service, tossApiClient } = makeContext({ selectQueue: [[makeIntent({ userId: 'other' })]] });
      await expect(service.issue(DTO, USER_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(tossApiClient.issueCashReceipt).not.toHaveBeenCalled();
    });

    it('결제 미완료 상태면 BadRequest', async () => {
      const { service } = makeContext({ selectQueue: [[makeIntent({ status: 'CREATED' })]] });
      await expect(service.issue(DTO, USER_ID)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('카드결제(무통장 charge 없음)면 BadRequest (NOT_ELIGIBLE)', async () => {
      const { service, tossApiClient } = makeContext({ selectQueue: [[makeIntent()]], methodType: 'TOSS' });
      await expect(service.issue(DTO, USER_ID)).rejects.toThrow('무통장입금 결제만');
      expect(tossApiClient.issueCashReceipt).not.toHaveBeenCalled();
    });

    it('이미 ISSUED 영수증이 있으면 Conflict', async () => {
      const { service } = makeContext({ selectQueue: [[makeIntent()], [makeReceipt()]] });
      await expect(service.issue(DTO, USER_ID)).rejects.toBeInstanceOf(ConflictException);
    });

    it('무통장 결제면 charge.amount 로 발급', async () => {
      const { service, tossApiClient } = makeContext({
        selectQueue: [[makeIntent()], [], [{ name: '상품A' }]],
        refundableCharges: [makeCharge({ amount: 7000 })],
        tossIssue: { ok: true, data: { receiptKey: 'rk', issueNumber: '123', receiptUrl: 'http://x' } },
      });
      const r = await service.issue(DTO, USER_ID);
      expect(tossApiClient.issueCashReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 7000, orderId: INTENT_ID, type: '소득공제' }),
      );
      expect(r.status).toBe('ISSUED');
    });
  });

  describe('issue() — 토스가 결제에 붙여 발급한 영수증과의 중복 (#1117)', () => {
    const OK_ISSUE = { ok: true, data: { receiptKey: 'rk', issueNumber: '123', receiptUrl: 'http://x' } };

    it('토스 결제에 cashReceipt 가 붙어 있으면 Conflict 이고 발급하지 않는다', async () => {
      const { service, tossApiClient } = makeContext({
        selectQueue: [[makeIntent()], []],
        refundableCharges: [makeCharge({ responsePayload: { paymentKey: 'pk-1' } })],
        tossPayment: { ok: true, data: { cashReceipt: { receiptKey: 'auto' } } },
      });
      await expect(service.issue(DTO, USER_ID)).rejects.toThrow('이미 현금영수증을 발급했습니다');
      expect(tossApiClient.issueCashReceipt).not.toHaveBeenCalled();
    });

    it('발행 이력이 살아 있으면 Conflict', async () => {
      const { service } = makeContext({
        selectQueue: [[makeIntent()], []],
        refundableCharges: [makeCharge({ responsePayload: { paymentKey: 'pk-1' } })],
        tossPayment: {
          ok: true,
          data: { cashReceipts: [{ transactionType: 'CONFIRM', issueStatus: 'COMPLETED', amount: 10000 }] },
        },
      });
      await expect(service.issue(DTO, USER_ID)).rejects.toBeInstanceOf(ConflictException);
    });

    it('실패했거나 전액 취소된 이력뿐이면 발급한다', async () => {
      const { service, tossApiClient } = makeContext({
        selectQueue: [[makeIntent()], [], [{ name: '상품A' }]],
        refundableCharges: [makeCharge({ responsePayload: { paymentKey: 'pk-1' } })],
        tossPayment: {
          ok: true,
          data: {
            cashReceipt: { receiptKey: 'old' },
            cashReceipts: [
              { transactionType: 'CONFIRM', issueStatus: 'FAILED', amount: 10000 },
              { transactionType: 'CONFIRM', issueStatus: 'COMPLETED', amount: 10000 },
              { transactionType: 'CANCEL', issueStatus: 'COMPLETED', amount: 10000 },
            ],
          },
        },
        tossIssue: OK_ISSUE,
      });
      await service.issue(DTO, USER_ID);
      expect(tossApiClient.issueCashReceipt).toHaveBeenCalled();
    });

    it('발급 금액만큼 취소가 진행 중이면 아직 살아 있다고 보고 발급하지 않는다', async () => {
      const { service, tossApiClient } = makeContext({
        selectQueue: [[makeIntent()], []],
        refundableCharges: [makeCharge({ responsePayload: { paymentKey: 'pk-1' } })],
        tossPayment: {
          ok: true,
          data: {
            cashReceipts: [
              { transactionType: 'CONFIRM', issueStatus: 'COMPLETED', amount: 10000 },
              { transactionType: 'CANCEL', issueStatus: 'IN_PROGRESS', amount: 10000 },
            ],
          },
        },
      });
      await expect(service.issue(DTO, USER_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(tossApiClient.issueCashReceipt).not.toHaveBeenCalled();
    });

    it('CAPTURE charge 면 원래 AUTHORIZE charge 의 스냅샷으로 위젯 키를 고른다', async () => {
      const AUTH_ID = '44444444-4444-4444-8444-444444444444';
      const { service, tossApiClient } = makeContext({
        selectQueue: [[makeIntent()], [], [{ name: '상품A' }]],
        refundableCharges: [
          makeCharge({
            operation: 'CAPTURE',
            requestPayload: { authorizeChargeId: AUTH_ID },
            providerTransactionId: 'pk-1',
          }),
        ],
        chargeById: makeCharge({
          id: AUTH_ID,
          responsePayload: { paymentKey: 'pk-1', nextAction: { checkoutMode: 'WIDGET' } },
        }),
        tossIssue: OK_ISSUE,
      });
      await service.issue(DTO, USER_ID);
      expect(tossApiClient.getPayment).toHaveBeenCalledWith('pk-1', true);
      expect(tossApiClient.issueCashReceipt).toHaveBeenCalled();
    });

    it('수동 입금확인 건(providerTransactionId = 입금자 메모)은 조회 없이 발급한다', async () => {
      const { service, tossApiClient } = makeContext({
        selectQueue: [[makeIntent()], [], [{ name: '상품A' }]],
        refundableCharges: [makeCharge({ providerTransactionId: '홍길동 입금' })],
        tossIssue: OK_ISSUE,
      });
      await service.issue(DTO, USER_ID);
      expect(tossApiClient.getPayment).not.toHaveBeenCalled();
      expect(tossApiClient.issueCashReceipt).toHaveBeenCalled();
    });

    it('토스 조회가 실패하면 발급하지 않는다', async () => {
      const { service, tossApiClient } = makeContext({
        selectQueue: [[makeIntent()], []],
        refundableCharges: [makeCharge({ responsePayload: { paymentKey: 'pk-1' } })],
        tossPayment: { ok: false, error: { code: 'X', message: 'down' } },
      });
      await expect(service.issue(DTO, USER_ID)).rejects.toThrow('토스 결제 정보를 확인하지 못했습니다');
      expect(tossApiClient.issueCashReceipt).not.toHaveBeenCalled();
    });
  });

  describe('issue() — 먼저 부분 환불된 결제', () => {
    it('성공한 환불을 뺀 남은 금액으로 발급한다', async () => {
      const { service, tossApiClient } = makeContext({
        selectQueue: [[makeIntent()], [], [{ name: '상품A' }]],
        refundableCharges: [makeCharge({ amount: 1000 })],
        succeededRefunds: [{ amount: 200 }, { amount: 100 }],
        tossIssue: { ok: true, data: { receiptKey: 'rk', issueNumber: '123', receiptUrl: 'http://x' } },
      });
      const r = await service.issue(DTO, USER_ID);
      expect(tossApiClient.issueCashReceipt).toHaveBeenCalledWith(expect.objectContaining({ amount: 700 }));
      expect(r.amount).toBe(700);
    });

    it('환불 합계가 결제 금액 이상이면 발급하지 않는다', async () => {
      const { service, tossApiClient } = makeContext({
        selectQueue: [[makeIntent()], []],
        refundableCharges: [makeCharge({ amount: 1000 })],
        succeededRefunds: [{ amount: 1000 }],
      });
      await expect(service.issue(DTO, USER_ID)).rejects.toThrow('발급할 금액이 없습니다');
      expect(tossApiClient.issueCashReceipt).not.toHaveBeenCalled();
    });
  });

  describe('issue() — 합계를 읽은 뒤 저장 전에 성공한 환불', () => {
    const ISSUED = { ok: true, data: { receiptKey: 'rk-001', issueNumber: '123', receiptUrl: 'http://x' } };

    it('저장 직후 맞추기로 그 환불만큼 취소한다', async () => {
      const { service, tossApiClient, receipt } = makeContext({
        selectQueue: [[makeIntent()], [], [{ name: '상품A' }]],
        refundableCharges: [makeCharge({ amount: 1000 })],
        chargeById: makeCharge({ amount: 1000 }),
        receipt: makeReceipt({ amount: 1000 }),
        // 발급 금액 계산 땐 0, 저장 직후 맞출 땐 그사이 성공한 200
        refundsByCall: [[]],
        succeededRefunds: [{ amount: 200 }],
        tossIssue: ISSUED,
      });
      await service.issue(DTO, USER_ID);
      expect(tossApiClient.issueCashReceipt).toHaveBeenCalledWith(expect.objectContaining({ amount: 1000 }));
      expect(tossApiClient.cancelCashReceipt).toHaveBeenCalledWith('rk-001', 200, expect.any(String));
      expect(receipt).toMatchObject({ canceledAmount: 200, status: 'ISSUED', requestPayload: {} });
    });

    it('맞추기가 실패해도 발급 결과는 돌려준다', async () => {
      const { service } = makeContext({
        selectQueue: [[makeIntent()], [], [{ name: '상품A' }]],
        refundableCharges: [makeCharge({ amount: 1000 })],
        chargeById: makeCharge({ amount: 1000 }),
        receipt: makeReceipt({ amount: 1000 }),
        refundsByCall: [[]],
        succeededRefunds: [{ amount: 200 }],
        tossIssue: ISSUED,
        tossCancel: { ok: false, statusCode: 400, error: { code: 'X', message: 'fail' } },
      });
      await expect(service.issue(DTO, USER_ID)).resolves.toMatchObject({ status: 'ISSUED', amount: 1000 });
    });
  });

  describe('cancelForRefund() — 환불 연동', () => {
    it('전액 환불이면 남은 영수증을 전부 취소하고 CANCELED', async () => {
      const { service, tossApiClient, receipt } = makeContext({
        receipt: makeReceipt({ amount: 10000 }),
        succeededRefunds: [{ amount: 10000 }],
      });
      await service.cancelForRefund(CHARGE_ID);
      expect(tossApiClient.cancelCashReceipt).toHaveBeenCalledWith('rk-001', 10000, expect.any(String));
      expect(receipt).toMatchObject({ canceledAmount: 10000, status: 'CANCELED' });
      expect(receipt?.canceledAt).toBeInstanceOf(Date);
    });

    it('부분 환불이면 남은 결제 금액에 맞춰 취소하고 ISSUED 유지', async () => {
      // 결제 10000, 이미 3000 취소된 영수증, 성공 환불 누계 7000 → 영수증은 3000 이어야 한다 → 4000 취소
      const { service, tossApiClient, receipt } = makeContext({
        receipt: makeReceipt({ amount: 10000, canceledAmount: 3000 }),
        succeededRefunds: [{ amount: 3000 }, { amount: 4000 }],
      });
      await service.cancelForRefund(CHARGE_ID);
      expect(tossApiClient.cancelCashReceipt).toHaveBeenCalledWith('rk-001', 4000, expect.any(String));
      expect(receipt).toMatchObject({ canceledAmount: 7000, status: 'ISSUED', canceledAt: null });
    });

    it('발급 때 이미 뺀 환불이 늦게 와도 또 취소하지 않는다', async () => {
      // 결제 1000 에서 300 환불 성공 뒤 700 으로 발급된 영수증
      const { service, tossApiClient } = makeContext({
        receipt: makeReceipt({ amount: 700 }),
        chargeById: makeCharge({ amount: 1000 }),
        succeededRefunds: [{ amount: 300 }],
      });
      await service.cancelForRefund(CHARGE_ID);
      expect(tossApiClient.cancelCashReceipt).not.toHaveBeenCalled();
    });

    it('같은 환불로 두 번 불려도 한 번만 취소된다', async () => {
      const { service, tossApiClient, receipt } = makeContext({
        receipt: makeReceipt({ amount: 10000 }),
        succeededRefunds: [{ amount: 4000 }],
      });
      await service.cancelForRefund(CHARGE_ID);
      await service.cancelForRefund(CHARGE_ID);
      expect(tossApiClient.cancelCashReceipt).toHaveBeenCalledTimes(1);
      expect(receipt?.canceledAmount).toBe(4000);
    });

    it('ISSUED 영수증이 없으면 토스 호출 안 함', async () => {
      const { service, tossApiClient } = makeContext({ selectQueue: [[]], succeededRefunds: [{ amount: 5000 }] });
      await service.cancelForRefund(CHARGE_ID);
      expect(tossApiClient.cancelCashReceipt).not.toHaveBeenCalled();
    });

    it('토스가 거절하면 취소액은 그대로 두고 남긴 취소를 지운다 — 곧바로 다시 보내지 않는다', async () => {
      const { service, tossApiClient, receipt } = makeContext({
        receipt: makeReceipt(),
        succeededRefunds: [{ amount: 10000 }],
        tossCancel: { ok: false, statusCode: 400, error: { code: 'X', message: 'fail' } },
      });
      await service.cancelForRefund(CHARGE_ID);
      expect(tossApiClient.cancelCashReceipt).toHaveBeenCalledTimes(1);
      expect(receipt).toMatchObject({ canceledAmount: 0, status: 'ISSUED', requestPayload: {} });
    });

    it('보내기 전에 금액과 멱등 키를 먼저 남긴다 — 보낸 뒤 프로세스가 죽어도 같은 키로 확정할 수 있게', async () => {
      const ctx = makeContext({
        receipt: makeReceipt({ amount: 1000 }),
        chargeById: makeCharge({ amount: 1000 }),
        succeededRefunds: [{ amount: 300 }],
      });
      let storedAtSend: unknown;
      ctx.tossApiClient.cancelCashReceipt.mockImplementationOnce(() => {
        storedAtSend = ctx.receipt?.requestPayload?.pendingCancel;
        return Promise.resolve({ ok: true, data: {} });
      });
      await ctx.service.cancelForRefund(CHARGE_ID);
      const sentKey = ctx.tossApiClient.cancelCashReceipt.mock.calls[0][2];
      expect(storedAtSend).toMatchObject({ amount: 300, idempotencyKey: sentKey });
    });

    it('보내는 사이 성공한 환불도 확정 뒤 최신 합계로 다시 맞춘다 — 겹친 호출은 처리 중으로 물러난다', async () => {
      const refundRows = [{ amount: 2000 }];
      const ctx = makeContext({ receipt: makeReceipt({ amount: 10000 }), succeededRefunds: refundRows });
      ctx.tossApiClient.cancelCashReceipt.mockImplementationOnce(() => {
        refundRows.push({ amount: 3000 });
        return Promise.resolve({ ok: true, data: {} });
      });
      await ctx.service.cancelForRefund(CHARGE_ID);
      expect(ctx.tossApiClient.cancelCashReceipt).toHaveBeenNthCalledWith(2, 'rk-001', 3000, expect.any(String));
      expect(ctx.receipt).toMatchObject({ canceledAmount: 5000, requestPayload: {} });
    });

    it('보내는 사이 다른 호출이 같은 취소를 확정했으면 취소액을 또 더하지 않는다', async () => {
      const ctx = makeContext({
        receipt: makeReceipt({ amount: 1000, requestPayload: { pendingCancel: pendingCancelOf(200) } }),
        chargeById: makeCharge({ amount: 1000 }),
        succeededRefunds: [{ amount: 200 }],
      });
      ctx.tossApiClient.cancelCashReceipt.mockImplementationOnce(() => {
        // 같은 키로 먼저 확정한 다른 호출
        Object.assign(ctx.receipt ?? {}, { canceledAmount: 200, requestPayload: {} });
        return Promise.resolve({ ok: true, data: {} });
      });
      await ctx.service.cancelForRefund(CHARGE_ID);
      expect(ctx.receipt?.canceledAmount).toBe(200);
    });
  });

  describe('cancelForRefund() — 응답이 끊긴 취소', () => {
    const pendingOf = (amount: number, requestedAt?: string) => ({
      pendingCancel: pendingCancelOf(amount, requestedAt),
    });

    it('남은 취소를 같은 키로 먼저 확정하고, 반영됐으면 그만큼 빼고 나머지만 취소한다', async () => {
      // 1000 영수증, 200 취소가 반영됐는데 기록 안 됨, 환불 누계 300 → 700 이어야 한다
      const { service, tossApiClient, receipt } = makeContext({
        receipt: makeReceipt({ amount: 1000, requestPayload: pendingOf(200) }),
        chargeById: makeCharge({ amount: 1000 }),
        succeededRefunds: [{ amount: 200 }, { amount: 100 }],
      });
      await service.cancelForRefund(CHARGE_ID);
      expect(tossApiClient.cancelCashReceipt).toHaveBeenNthCalledWith(1, 'rk-001', 200, 'k-pending');
      expect(tossApiClient.cancelCashReceipt).toHaveBeenNthCalledWith(2, 'rk-001', 100, expect.any(String));
      expect(receipt).toMatchObject({ canceledAmount: 300, status: 'ISSUED', requestPayload: {} });
    });

    it('남은 취소가 거절되면 반영 안 된 것으로 보고 목표까지 새로 취소한다', async () => {
      const { service, tossApiClient, receipt } = makeContext({
        receipt: makeReceipt({ amount: 1000, requestPayload: pendingOf(200) }),
        chargeById: makeCharge({ amount: 1000 }),
        succeededRefunds: [{ amount: 300 }],
        tossCancelByCall: [{ ok: false, statusCode: 400, error: { code: 'INVALID', message: 'no' } }],
      });
      await service.cancelForRefund(CHARGE_ID);
      expect(tossApiClient.cancelCashReceipt).toHaveBeenNthCalledWith(2, 'rk-001', 300, expect.any(String));
      expect(receipt).toMatchObject({ canceledAmount: 300, requestPayload: {} });
    });

    it('거절된 취소를 다시 시도할 때는 새 멱등 키를 쓴다 — 토스는 실패 응답도 캐시한다', async () => {
      const rejected = { ok: false, statusCode: 400, error: { code: 'INVALID', message: 'no' } };
      const first = makeContext({
        receipt: makeReceipt({ amount: 1000 }),
        chargeById: makeCharge({ amount: 1000 }),
        succeededRefunds: [{ amount: 300 }],
        tossCancel: rejected,
      });
      await first.service.cancelForRefund(CHARGE_ID);
      await first.service.cancelForRefund(CHARGE_ID);
      const [firstCall, secondCall] = first.tossApiClient.cancelCashReceipt.mock.calls;
      expect(firstCall[2]).not.toBe(secondCall[2]);
    });

    it('남은 취소가 또 결과를 모르면 더 취소하지 않고 기록을 그대로 둔다', async () => {
      const { service, tossApiClient, receipt } = makeContext({
        receipt: makeReceipt({ amount: 1000, requestPayload: pendingOf(200) }),
        chargeById: makeCharge({ amount: 1000 }),
        succeededRefunds: [{ amount: 300 }],
        tossCancelByCall: [new Error('socket hang up')],
      });
      await service.cancelForRefund(CHARGE_ID);
      expect(tossApiClient.cancelCashReceipt).toHaveBeenCalledTimes(1);
      expect(receipt).toMatchObject({
        canceledAmount: 0,
        requestPayload: { pendingCancel: { amount: 200, idempotencyKey: 'k-pending' } },
      });
    });

    it.each([401, 403, 429])(
      '남은 취소가 %d 로 막히면 원래 결과를 모르므로 기록을 지우지 않는다',
      async (statusCode) => {
        const { service, tossApiClient, receipt } = makeContext({
          receipt: makeReceipt({ amount: 1000, requestPayload: pendingOf(200) }),
          chargeById: makeCharge({ amount: 1000 }),
          succeededRefunds: [{ amount: 300 }],
          tossCancelByCall: [{ ok: false, statusCode, error: { code: 'X', message: 'blocked' } }],
        });
        await service.cancelForRefund(CHARGE_ID);
        expect(tossApiClient.cancelCashReceipt).toHaveBeenCalledTimes(1);
        expect(receipt).toMatchObject({
          canceledAmount: 0,
          requestPayload: { pendingCancel: { amount: 200, idempotencyKey: 'k-pending' } },
        });
      },
    );

    it('크론은 남은 취소가 있는 영수증을 다음 환불 없이 확정한다', async () => {
      const { service, tossApiClient, receipt } = makeContext({
        selectQueue: [[{ chargeId: CHARGE_ID }]],
        receipt: makeReceipt({ amount: 1000, requestPayload: pendingOf(300) }),
        chargeById: makeCharge({ amount: 1000 }),
        succeededRefunds: [{ amount: 300 }],
      });
      await expect(service.resolvePendingCancels()).resolves.toEqual({ scanned: 1, failed: 0 });
      expect(tossApiClient.cancelCashReceipt).toHaveBeenCalledTimes(1);
      expect(tossApiClient.cancelCashReceipt).toHaveBeenCalledWith('rk-001', 300, 'k-pending');
      expect(receipt).toMatchObject({ canceledAmount: 300, requestPayload: {} });
    });

    it('멱등 키 유효기간이 지난 남은 취소는 다시 보내지 않는다', async () => {
      const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const { service, tossApiClient } = makeContext({
        receipt: makeReceipt({ amount: 1000, requestPayload: pendingOf(200, old) }),
        chargeById: makeCharge({ amount: 1000 }),
        succeededRefunds: [{ amount: 300 }],
      });
      await service.cancelForRefund(CHARGE_ID);
      expect(tossApiClient.cancelCashReceipt).not.toHaveBeenCalled();
    });

    it.each([
      ['응답 없음', new Error('ETIMEDOUT')],
      ['5xx', { ok: false, statusCode: 502, error: { code: 'UNKNOWN', message: 'bad gateway' } }],
      [
        '이전 요청 처리 중',
        { ok: false, statusCode: 409, error: { code: 'IDEMPOTENT_REQUEST_PROCESSING', message: '' } },
      ],
    ])('새 취소 결과를 모르면(%s) 취소액은 그대로 두고 남긴 취소를 유지한다', async (_label, result) => {
      const { service, receipt } = makeContext({
        receipt: makeReceipt({ amount: 1000 }),
        chargeById: makeCharge({ amount: 1000 }),
        succeededRefunds: [{ amount: 300 }],
        tossCancelByCall: [result],
      });
      await service.cancelForRefund(CHARGE_ID);
      expect(receipt).toMatchObject({
        canceledAmount: 0,
        status: 'ISSUED',
        requestPayload: { pendingCancel: { amount: 300 } },
      });
    });
  });

  describe('결제분 charge 묶음 — 환불 행은 CAPTURE 와 원래 AUTHORIZE 어느 쪽 id 로도 남는다', () => {
    const AUTH_ID = '44444444-4444-4444-8444-444444444444';
    const CAP_ID = '55555555-5555-4555-8555-555555555555';
    const capture = makeCharge({ id: CAP_ID, operation: 'CAPTURE', requestPayload: { authorizeChargeId: AUTH_ID } });
    const otherCapture = makeCharge({
      id: '66666666-6666-4666-8666-666666666666',
      operation: 'CAPTURE',
      requestPayload: { authorizeChargeId: 'other-leg' },
    });

    it('CAPTURE 에서 시작하면 원래 AUTHORIZE 를 포함한다', async () => {
      const { service } = makeContext({ captures: [capture, otherCapture] });
      await expect(service['legChargeIds'](capture as any)).resolves.toEqual([CAP_ID, AUTH_ID]);
    });

    it('AUTHORIZE 에서 시작하면 그 CAPTURE 를 찾고 다른 결제분은 섞지 않는다 (환불 신청 승인 경로)', async () => {
      const { service } = makeContext({ captures: [capture, otherCapture] });
      await expect(service['legChargeIds'](makeCharge({ id: AUTH_ID }) as any)).resolves.toEqual([AUTH_ID, CAP_ID]);
    });
  });
});
