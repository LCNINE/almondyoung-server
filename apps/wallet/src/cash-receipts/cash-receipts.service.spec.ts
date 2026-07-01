import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CashReceiptsService } from './cash-receipts.service';

const INTENT_ID = 'intent-001';
const CHARGE_ID = 'charge-001';
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

function makeCharge(overrides: Partial<{ amount: number }> = {}) {
  return { id: CHARGE_ID, intentId: INTENT_ID, paymentMethodId: PM_ID, amount: overrides.amount ?? 10000, currency: 'KRW' };
}

function makeReceipt(overrides: Partial<{ amount: number; canceledAmount: number; status: string }> = {}) {
  return {
    id: 'cr-001',
    chargeId: CHARGE_ID,
    intentId: INTENT_ID,
    amount: overrides.amount ?? 10000,
    canceledAmount: overrides.canceledAmount ?? 0,
    status: overrides.status ?? 'ISSUED',
    receiptKey: 'rk-001',
    canceledAt: null,
  };
}

/**
 * db.select() 는 호출 순서대로 selectQueue 의 결과를 반환한다 (limit/orderBy 공통).
 * issue() 의 select 순서: 1) findIntentOrThrow  2) findActiveByCharge  3) buildOrderName(items)
 * cancelForRefund() 의 select 순서: 1) findActiveByCharge
 */
function makeContext(opts: {
  selectQueue?: unknown[][];
  refundableCharges?: ReturnType<typeof makeCharge>[];
  methodType?: string;
  tossIssue?: { ok: boolean; data?: any; error?: any };
  tossCancel?: { ok: boolean; data?: any; error?: any };
} = {}) {
  const selectQueue = [...(opts.selectQueue ?? [])];
  const updateCalls: Array<Record<string, unknown>> = [];
  const resultPromise = () => Promise.resolve(selectQueue.shift() ?? []);

  const db = {
    db: {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({
          where: () => ({ limit: () => resultPromise(), orderBy: () => resultPromise() }),
        }),
      })),
      insert: jest.fn().mockImplementation(() => ({
        values: (vals: any) => ({ returning: () => Promise.resolve([{ id: 'cr-new', ...vals }]) }),
      })),
      update: jest.fn().mockImplementation(() => ({
        set: (vals: Record<string, unknown>) => ({
          where: () => {
            updateCalls.push(vals);
            return Promise.resolve();
          },
        }),
      })),
    },
  };

  const chargesService = {
    findRefundableByIntent: jest.fn().mockResolvedValue(opts.refundableCharges ?? [makeCharge()]),
  };
  const paymentMethodsService = {
    findById: jest.fn().mockResolvedValue({ id: PM_ID, type: opts.methodType ?? 'BANK_TRANSFER' }),
  };
  const tossApiClient = {
    issueCashReceipt: jest.fn().mockResolvedValue(opts.tossIssue ?? { ok: true, data: {} }),
    cancelCashReceipt: jest.fn().mockResolvedValue(opts.tossCancel ?? { ok: true, data: {} }),
  };

  const service = new CashReceiptsService(
    db as any,
    chargesService as any,
    paymentMethodsService as any,
    tossApiClient as any,
  );
  return { service, tossApiClient, updateCalls };
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

  describe('cancelForRefund() — 환불 연동', () => {
    it('전액 취소 시 status=CANCELED, canceledAt 설정', async () => {
      const { service, tossApiClient, updateCalls } = makeContext({ selectQueue: [[makeReceipt({ amount: 10000 })]] });
      await service.cancelForRefund(CHARGE_ID, 10000);
      expect(tossApiClient.cancelCashReceipt).toHaveBeenCalledWith('rk-001', 10000);
      expect(updateCalls[0]).toMatchObject({ canceledAmount: 10000, status: 'CANCELED' });
      expect(updateCalls[0].canceledAt).toBeInstanceOf(Date);
    });

    it('부분 취소 시 status는 ISSUED 유지, canceledAmount 누적', async () => {
      const { service, updateCalls } = makeContext({
        selectQueue: [[makeReceipt({ amount: 10000, canceledAmount: 3000 })]],
      });
      await service.cancelForRefund(CHARGE_ID, 4000);
      expect(updateCalls[0]).toMatchObject({ canceledAmount: 7000, status: 'ISSUED' });
      expect(updateCalls[0].canceledAt).toBeNull();
    });

    it('환불금액이 잔여 취소가능액을 넘으면 잔여분만 취소', async () => {
      const { service, tossApiClient } = makeContext({
        selectQueue: [[makeReceipt({ amount: 10000, canceledAmount: 8000 })]],
      });
      await service.cancelForRefund(CHARGE_ID, 5000);
      expect(tossApiClient.cancelCashReceipt).toHaveBeenCalledWith('rk-001', 2000);
    });

    it('ISSUED 영수증이 없으면 토스 호출 안 함', async () => {
      const { service, tossApiClient } = makeContext({ selectQueue: [[]] });
      await service.cancelForRefund(CHARGE_ID, 5000);
      expect(tossApiClient.cancelCashReceipt).not.toHaveBeenCalled();
    });

    it('토스 취소 실패 시 DB 업데이트 안 함 (환불은 유지)', async () => {
      const { service, updateCalls } = makeContext({
        selectQueue: [[makeReceipt()]],
        tossCancel: { ok: false, error: { code: 'X', message: 'fail' } },
      });
      await service.cancelForRefund(CHARGE_ID, 10000);
      expect(updateCalls).toHaveLength(0);
    });
  });
});
