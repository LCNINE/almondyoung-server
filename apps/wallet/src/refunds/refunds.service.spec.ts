import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RefundsService } from './refunds.service';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const CHARGE_ID = 'charge-001';
const INTENT_ID = 'intent-001';
const PM_ID = 'pm-001';
const REFUND_ID = 'refund-001';
const USER_ID = 'user-001';

function makeCharge(overrides: Partial<{ id: string; status: string; amount: number; paymentMethodId: string }> = {}) {
  return { id: CHARGE_ID, intentId: INTENT_ID, paymentMethodId: PM_ID, status: 'SUCCEEDED', amount: 10000, currency: 'KRW', ...overrides };
}

function makeMethod(type: string = 'TOSS') {
  return { id: PM_ID, type, providerData: {} };
}

function makeInsertedRefund(overrides: Partial<{ amount: number; reasonCode: string | null }> = {}) {
  return {
    id: REFUND_ID,
    chargeId: CHARGE_ID,
    intentId: INTENT_ID,
    status: 'PENDING',
    amount: overrides.amount ?? 5000,
    currency: 'KRW',
    reasonCode: overrides.reasonCode ?? null,
    reasonMessage: null,
    providerRefundId: null,
    createdAt: new Date(),
  };
}

/**
 * Build a fully wired mock context for RefundsService.
 * Each component is exposed for per-test customization.
 */
function makeContext(options: {
  charge?: ReturnType<typeof makeCharge>;
  method?: ReturnType<typeof makeMethod>;
  priorRefundedAmount?: number;   // sum of SUCCEEDED/PENDING refunds already on this charge
  providerResult?: { status: string; errorCode?: string; errorMessage?: string; providerRefundId?: string };
  pendingRefund?: ReturnType<typeof makeInsertedRefund>;  // for confirmManual tests
} = {}) {
  const charge = options.charge ?? makeCharge();
  const method = options.method ?? makeMethod();
  const priorRefundedAmount = options.priorRefundedAmount ?? 0;
  const providerResult = options.providerResult ?? { status: 'SUCCEEDED', providerRefundId: 'prov-rf-001' };
  const pendingRefund = options.pendingRefund;

  // Track update calls
  const updateCalls: Array<{ set: Record<string, unknown> }> = [];

  // tx used inside transactions
  const makeTx = () => ({
    execute: jest.fn().mockResolvedValue([]),
    select: jest.fn().mockImplementation(() => ({
      from: (table: any) => ({
        where: () => [{ amount: priorRefundedAmount }],  // getRefundedTotalInTx
      }),
    })),
    insert: jest.fn().mockImplementation(() => ({
      values: (vals: any) => ({
        returning: jest.fn().mockResolvedValue([makeInsertedRefund({ amount: vals.amount, reasonCode: vals.reasonCode })]),
      }),
    })),
    update: jest.fn().mockImplementation(() => ({
      set: (setValues: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push({ set: setValues });
          return Promise.resolve();
        },
      }),
    })),
  });

  const db = {
    db: {
      // top-level select: used for findByIdOrThrow (refunds/paymentIntents)
      select: jest.fn().mockImplementation(() => ({
        from: (table: any) => ({
          where: () => ({
            limit: () => ({
              then: (cb: any) => {
                // For paymentIntents query (getIntentUserId)
                return Promise.resolve(cb([{ userId: USER_ID }]));
              },
            }),
          }),
        }),
      })),
      // top-level update: used outside transactions
      update: jest.fn().mockImplementation(() => ({
        set: (setValues: Record<string, unknown>) => ({
          where: () => {
            updateCalls.push({ set: setValues });
            return Promise.resolve();
          },
        }),
      })),
      transaction: jest.fn().mockImplementation(async (fn: any) => fn(makeTx())),
    },
  };

  const chargesService = { findById: jest.fn().mockResolvedValue(charge) };
  const paymentMethodsService = { findById: jest.fn().mockResolvedValue(method) };
  const provider = { refund: jest.fn().mockResolvedValue(providerResult) };
  const providerRegistry = { getProviderOrThrow: jest.fn().mockReturnValue(provider) };
  const stateTransitionService = {
    transitionRefund: jest.fn().mockResolvedValue({ entityId: REFUND_ID, previousStatus: 'PENDING', newStatus: 'SUCCEEDED' }),
  };

  // For confirmManual: select is called twice:
  //   1st call → findByIdOrThrow (returns pendingRefund)
  //   2nd call → getIntentUserId (returns userId)
  if (pendingRefund) {
    let callCount = 0;
    db.db.select = jest.fn().mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            then: (cb: any) => {
              callCount++;
              if (callCount === 1) return Promise.resolve(cb([pendingRefund]));
              return Promise.resolve(cb([{ userId: USER_ID }]));
            },
          }),
        }),
      }),
    }));
  }

  const service = new RefundsService(
    db as any,
    chargesService as any,
    paymentMethodsService as any,
    providerRegistry as any,
    stateTransitionService as any,
  );

  return { service, db, chargesService, paymentMethodsService, provider, providerRegistry, stateTransitionService, updateCalls };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RefundsService', () => {

  describe('중복/초과 환불 방지', () => {
    it('charge amount보다 큰 금액 환불 시 BadRequestException', async () => {
      const { service } = makeContext({ charge: makeCharge({ amount: 10000 }) });
      await expect(
        service.create({ chargeId: CHARGE_ID, amount: 15000 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('charge intentId 불일치 시 BadRequestException (CHARGE_INTENT_MISMATCH)', async () => {
      const { service } = makeContext({ charge: makeCharge() });
      await expect(
        service.create({ chargeId: CHARGE_ID, amount: 1000, intentId: 'wrong-intent' }),
      ).rejects.toThrow('does not belong to intent');
    });

    it('기존 SUCCEEDED 환불 합계를 초과하는 금액은 거절 (REFUND_AMOUNT_EXCEEDS_AVAILABLE)', async () => {
      // priorRefundedAmount = 8000, charge.amount = 10000, available = 2000
      const { service } = makeContext({ priorRefundedAmount: 8000 });
      await expect(
        service.create({ chargeId: CHARGE_ID, amount: 5000 }), // 5000 > 2000
      ).rejects.toThrow('exceeds available refundable amount');
    });

    it('available 금액 이내의 환불은 정상 처리', async () => {
      const { service } = makeContext({ priorRefundedAmount: 3000 }); // available = 7000
      await expect(
        service.create({ chargeId: CHARGE_ID, amount: 5000 }),
      ).resolves.toBeDefined();
    });

    it('provider 성공 시 status 직접 업데이트 없이 PENDING -> SUCCEEDED 전이로 완료한다', async () => {
      const { service, updateCalls, stateTransitionService } = makeContext({
        providerResult: { status: 'SUCCEEDED', providerRefundId: 'prov-rf-001' },
      });

      await service.create({ chargeId: CHARGE_ID, amount: 5000 });

      expect(updateCalls).toContainEqual({
        set: expect.objectContaining({ providerRefundId: 'prov-rf-001' }),
      });
      expect(updateCalls.some((c) => c.set.status === 'SUCCEEDED')).toBe(false);
      expect(stateTransitionService.transitionRefund).toHaveBeenCalledWith(
        REFUND_ID,
        'SUCCEEDED',
        expect.objectContaining({ reasonCode: 'REFUND_SUCCEEDED' }),
        'PENDING',
        expect.anything(),
      );
    });

    it('charge가 SUCCEEDED 아닌 상태면 환불 불가 (CHARGE_NOT_REFUNDABLE)', async () => {
      const { service } = makeContext({ charge: makeCharge({ status: 'PENDING' }) });
      await expect(
        service.create({ chargeId: CHARGE_ID, amount: 1000 }),
      ).rejects.toThrow('not in a refundable state');
    });
  });

  describe('provider 실패 처리', () => {
    it('provider 예외 시 reasonMessage에 PG 오류 저장, reasonCode는 보존', async () => {
      const { service, updateCalls, stateTransitionService } = makeContext({
        providerResult: undefined as any,  // will be overridden
      });
      // Override provider to throw
      const providerWithError = { refund: jest.fn().mockRejectedValue(new Error('PG_TIMEOUT: Connection refused')) };
      const { service: svc, updateCalls: uc, stateTransitionService: sts } = makeContext({});
      (svc as any).providerRegistry = { getProviderOrThrow: jest.fn().mockReturnValue(providerWithError) };

      // Use a fresh context with throwing provider
      const { service: service2, updateCalls: uc2, stateTransitionService: sts2 } = makeContext({
        providerResult: undefined as any,
      });
      const throwingProvider = { refund: jest.fn().mockRejectedValue(new Error('PG_TIMEOUT: Connection refused')) };
      jest.spyOn(service2['providerRegistry' as any], 'getProviderOrThrow').mockReturnValue(throwingProvider);

      await service2.create({ chargeId: CHARGE_ID, amount: 5000, reasonCode: 'CUSTOMER_REQUEST' });

      // stateTransitionService called with FAILED + PROVIDER_EXCEPTION
      expect(sts2.transitionRefund).toHaveBeenCalledWith(
        REFUND_ID,
        'FAILED',
        expect.objectContaining({ reasonCode: 'PROVIDER_EXCEPTION' }),
      );
      // The update call should set reasonMessage but NOT reasonCode
      const updateCall = uc2.find((c) => c.set.reasonMessage !== undefined);
      expect(updateCall?.set.reasonMessage).toContain('PG_TIMEOUT');
      expect(updateCall?.set.reasonCode).toBeUndefined(); // admin reasonCode 보존
    });

    it('provider가 FAILED status 반환 시 reasonMessage 저장, transition 호출', async () => {
      const { service, updateCalls, stateTransitionService } = makeContext({
        providerResult: { status: 'FAILED', errorCode: 'CARD_DECLINED', errorMessage: 'Insufficient funds' },
      });

      await service.create({ chargeId: CHARGE_ID, amount: 5000 });

      expect(stateTransitionService.transitionRefund).toHaveBeenCalledWith(
        REFUND_ID,
        'FAILED',
        expect.objectContaining({ reasonCode: 'CARD_DECLINED' }),
      );
      const updateCall = updateCalls.find((c) => c.set.reasonMessage !== undefined);
      expect(updateCall?.set.reasonMessage).toBe('Insufficient funds');
      expect(updateCall?.set.reasonCode).toBeUndefined(); // admin reasonCode 보존
    });
  });

  describe('BANK_TRANSFER provider', () => {
    it('BANK_TRANSFER 환불은 PENDING status 반환 (provider.refund 호출됨)', async () => {
      const { service, provider } = makeContext({
        method: makeMethod('BANK_TRANSFER'),
        providerResult: { status: 'PENDING' },
      });

      const result = await service.create({ chargeId: CHARGE_ID, amount: 5000 });

      expect(provider.refund).toHaveBeenCalled();
      // PENDING path: no SUCCEEDED transition call
      expect(result).toBeDefined();
    });

    it('confirmManual: BANK_TRANSFER가 아닌 결제수단은 거절', async () => {
      const { service, db, chargesService, paymentMethodsService } = makeContext({
        method: makeMethod('TOSS'),
        pendingRefund: makeInsertedRefund(),
      });
      chargesService.findById = jest.fn().mockResolvedValue(makeCharge());
      paymentMethodsService.findById = jest.fn().mockResolvedValue(makeMethod('TOSS'));

      await expect(
        service.confirmManual(REFUND_ID),
      ).rejects.toThrow('BANK_TRANSFER');
    });

    it('confirmManual: BANK_TRANSFER는 SUCCEEDED + REFUND_SUCCEEDED outbox 발행', async () => {
      const { service, chargesService, paymentMethodsService, stateTransitionService } = makeContext({
        method: makeMethod('BANK_TRANSFER'),
        pendingRefund: makeInsertedRefund(),
      });
      chargesService.findById = jest.fn().mockResolvedValue(makeCharge());
      paymentMethodsService.findById = jest.fn().mockResolvedValue(makeMethod('BANK_TRANSFER'));

      await service.confirmManual(REFUND_ID);

      expect(stateTransitionService.transitionRefund).toHaveBeenCalledWith(
        REFUND_ID,
        'SUCCEEDED',
        expect.objectContaining({
          reasonCode: 'MANUAL_CONFIRM',
          outboxEvent: expect.objectContaining({
            eventType: 'gateway.refund.succeeded', // GatewayEventType.REFUND_SUCCEEDED
          }),
        }),
        'PENDING',
      );
    });

    it('confirmManual: PENDING 아닌 환불은 거절', async () => {
      const { service } = makeContext({
        pendingRefund: { ...makeInsertedRefund(), status: 'SUCCEEDED' },
      });

      await expect(
        service.confirmManual(REFUND_ID),
      ).rejects.toThrow('PENDING 상태가 아닙니다');
    });

    it('confirmManual: 존재하지 않는 환불 ID는 NotFoundException', async () => {
      const { service, db } = makeContext({});
      db.db.select = jest.fn().mockImplementation(() => ({
        from: () => ({
          where: () => ({
            limit: () => ({ then: (cb: any) => Promise.resolve(cb([])) }),
          }),
        }),
      }));

      await expect(
        service.confirmManual('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
