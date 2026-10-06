import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { splitRefundOverRemaining } from './refund-plan';
import type { Refund } from '../types';

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
  refundableCharges?: ReturnType<typeof makeCharge>[];
  existingSucceededRefunds?: ReturnType<typeof makeInsertedRefund>[];
  priorRefundedAmount?: number;       // SUCCEEDED+PENDING total in the insert-phase transaction
  succeededRefundedAmount?: number;   // SUCCEEDED-only total in the post-SUCCEEDED transaction
  providerResult?: { status: string; errorCode?: string; errorMessage?: string; providerRefundId?: string };
  pendingRefund?: ReturnType<typeof makeInsertedRefund>;  // for confirmManual tests
  intentMetadata?: Record<string, unknown>;  // payment_intents.metadata for assertRefundable/getIntentUserId
} = {}) {
  const intentMetadata = options.intentMetadata ?? {};
  const charge = options.charge ?? makeCharge();
  const method = options.method ?? makeMethod();
  const refundableCharges = options.refundableCharges ?? [charge];
  const existingSucceededRefunds = options.existingSucceededRefunds ?? [];
  const priorRefundedAmount = options.priorRefundedAmount ?? 0;
  const succeededRefundedAmount = options.succeededRefundedAmount ?? 0;
  const providerResult = options.providerResult ?? { status: 'SUCCEEDED', providerRefundId: 'prov-rf-001' };
  const pendingRefund = options.pendingRefund;

  // Track update calls
  const updateCalls: Array<{ set: Record<string, unknown> }> = [];

  // tx used inside transactions
  // txIndex distinguishes the insert transaction (1st) from the SUCCEEDED/confirmManual transaction (2nd+).
  // confirmManual has only one tx call — detected via pendingRefund presence — and uses succeededRefundedAmount.
  let txIndex = 0;
  const makeTx = () => {
    txIndex++;
    const isInsertTx = !pendingRefund && txIndex === 1;
    const selectAmount = isInsertTx ? priorRefundedAmount : succeededRefundedAmount;
    return {
      execute: jest.fn().mockResolvedValue([]),
      select: jest.fn().mockImplementation(() => ({
        from: () => ({
          where: () => [{ amount: selectAmount }],
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
    };
  };

  const db = {
    db: {
      // top-level select: used for findByIdOrThrow (refunds/paymentIntents)
      select: jest.fn().mockImplementation(() => ({
        from: (table: any) => ({
          where: () => ({
            orderBy: () => Promise.resolve(existingSucceededRefunds),
            limit: () => ({
              then: (cb: any) => {
                // For paymentIntents query (getIntentUserId / assertRefundable)
                return Promise.resolve(cb([{ userId: USER_ID, metadata: intentMetadata }]));
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

  const chargesService = {
    findById: jest.fn().mockResolvedValue(charge),
    findRefundableByIntent: jest.fn().mockResolvedValue(refundableCharges),
  };
  const paymentMethodsService = { findById: jest.fn().mockResolvedValue(method) };
  const provider = { refund: jest.fn().mockResolvedValue(providerResult) };
  const providerRegistry = { getProviderOrThrow: jest.fn().mockReturnValue(provider) };
  const stateTransitionService = {
    transitionRefund: jest.fn().mockResolvedValue({ entityId: REFUND_ID, previousStatus: 'PENDING', newStatus: 'SUCCEEDED' }),
    transitionCharge: jest.fn().mockResolvedValue({ entityId: CHARGE_ID, previousStatus: 'SUCCEEDED', newStatus: 'REFUNDED' }),
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
              return Promise.resolve(cb([{ userId: USER_ID, metadata: intentMetadata }]));
            },
          }),
        }),
      }),
    }));
  }

  const cashReceiptsService = { cancelForRefund: async () => undefined };
  const service = new RefundsService(
    db as any,
    chargesService as any,
    cashReceiptsService as any,
    paymentMethodsService as any,
    providerRegistry as any,
    stateTransitionService as any,
  );

  return { service, db, chargesService, paymentMethodsService, provider, providerRegistry, stateTransitionService, updateCalls };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RefundsService', () => {

  describe('멤버십 결제 환불 차단', () => {
    it('create: MEMBERSHIP_FEE intent 는 환불 거절 (MEMBERSHIP_REFUND_NOT_ALLOWED)', async () => {
      const { service } = makeContext({ intentMetadata: { type: 'MEMBERSHIP_FEE' } });
      await expect(service.create({ chargeId: CHARGE_ID, amount: 5000 })).rejects.toThrow('멤버십 결제는 환불할 수 없습니다');
    });

    it('create: allowMembershipRefund=true (admin 강제취소 예외) 면 통과', async () => {
      const { service } = makeContext({ intentMetadata: { type: 'MEMBERSHIP_FEE' } });
      await expect(
        service.create({ chargeId: CHARGE_ID, amount: 5000, allowMembershipRefund: true }),
      ).resolves.toBeDefined();
    });

    it('confirmManual: 차단은 create() 길목에서만 — 이미 PENDING 인 건은 완료 허용', async () => {
      const { service } = makeContext({
        method: makeMethod('BANK_TRANSFER'),
        pendingRefund: makeInsertedRefund(),
        intentMetadata: { type: 'MEMBERSHIP_FEE' },
      });
      await expect(service.confirmManual(REFUND_ID)).resolves.toBeDefined();
    });

    it('일반 결제(metadata.type 없음)는 정상 환불', async () => {
      const { service } = makeContext({ priorRefundedAmount: 0 });
      await expect(service.create({ chargeId: CHARGE_ID, amount: 5000 })).resolves.toBeDefined();
    });
  });

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

    it('intent가 이미 전액 환불되어 환불 가능 charge가 없으면 기존 성공 환불을 반환한다', async () => {
      const existingRefund = { ...makeInsertedRefund({ amount: 10000 }), status: 'SUCCEEDED' };
      const { service, chargesService, provider, db } = makeContext({
        refundableCharges: [],
        existingSucceededRefunds: [existingRefund],
      });

      await expect(service.createByIntent(INTENT_ID, { amount: 10000 })).resolves.toEqual([existingRefund]);
      expect(chargesService.findRefundableByIntent).toHaveBeenCalledWith(INTENT_ID);
      expect(provider.refund).not.toHaveBeenCalled();
      expect(db.db.transaction).not.toHaveBeenCalled();
    });

    it('환불 가능 charge가 없고 기존 성공 환불도 부족하면 REFUNDABLE_CHARGE_NOT_FOUND', async () => {
      const existingRefund = { ...makeInsertedRefund({ amount: 3000 }), status: 'SUCCEEDED' };
      const { service, provider } = makeContext({
        refundableCharges: [],
        existingSucceededRefunds: [existingRefund],
      });

      await expect(service.createByIntent(INTENT_ID, { amount: 10000 })).rejects.toThrow('No refundable charge found');
      expect(provider.refund).not.toHaveBeenCalled();
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
        expect.anything(), // tx — confirmManual now wraps in a transaction
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

  describe('P0.3: charge REFUNDED 전환 (환불 완료 후)', () => {
    describe('create() — provider SUCCEEDED', () => {
      it('전액 환불 완료 시 transitionCharge(SUCCEEDED → REFUNDED) 호출', async () => {
        const { service, stateTransitionService } = makeContext({
          charge: makeCharge({ amount: 10000 }),
          succeededRefundedAmount: 10000, // tx-2에서 SUCCEEDED 합계가 charge.amount 이상
        });

        await service.create({ chargeId: CHARGE_ID, amount: 10000 });

        expect(stateTransitionService.transitionCharge).toHaveBeenCalledWith(
          CHARGE_ID,
          'REFUNDED',
          expect.objectContaining({ reasonCode: 'FULLY_REFUNDED' }),
          'SUCCEEDED',
          expect.anything(),
        );
      });

      it('부분 환불 시 transitionCharge 호출하지 않음', async () => {
        const { service, stateTransitionService } = makeContext({
          charge: makeCharge({ amount: 10000 }),
          succeededRefundedAmount: 5000, // 5000 < 10000 → 부분 환불
        });

        await service.create({ chargeId: CHARGE_ID, amount: 5000 });

        expect(stateTransitionService.transitionCharge).not.toHaveBeenCalled();
      });

      it('provider FAILED 시 transitionCharge 호출하지 않음', async () => {
        const { service, stateTransitionService } = makeContext({
          providerResult: { status: 'FAILED', errorCode: 'CARD_DECLINED' },
          succeededRefundedAmount: 10000, // 값이 있어도 FAILED path에서는 체크 안 함
        });

        await service.create({ chargeId: CHARGE_ID, amount: 5000 });

        expect(stateTransitionService.transitionCharge).not.toHaveBeenCalled();
      });

      it('provider PENDING 시 transitionCharge 호출하지 않음', async () => {
        const { service, stateTransitionService } = makeContext({
          providerResult: { status: 'PENDING' },
          succeededRefundedAmount: 10000,
        });

        await service.create({ chargeId: CHARGE_ID, amount: 5000 });

        expect(stateTransitionService.transitionCharge).not.toHaveBeenCalled();
      });

      it('provider 예외 발생 시 transitionCharge 호출하지 않음', async () => {
        const { service, stateTransitionService } = makeContext({ succeededRefundedAmount: 10000 });
        const throwingProvider = { refund: jest.fn().mockRejectedValue(new Error('PG_TIMEOUT')) };
        jest.spyOn((service as any).providerRegistry, 'getProviderOrThrow').mockReturnValue(throwingProvider);

        await service.create({ chargeId: CHARGE_ID, amount: 5000 });

        expect(stateTransitionService.transitionCharge).not.toHaveBeenCalled();
      });
    });

    describe('confirmManual() — BANK_TRANSFER', () => {
      it('전액 환불 완료 시 transitionCharge(SUCCEEDED → REFUNDED) 호출', async () => {
        const { service, chargesService, paymentMethodsService, stateTransitionService } = makeContext({
          charge: makeCharge({ amount: 5000 }),
          method: makeMethod('BANK_TRANSFER'),
          pendingRefund: makeInsertedRefund({ amount: 5000 }),
          succeededRefundedAmount: 5000, // 환불 후 SUCCEEDED 합계 = charge.amount
        });
        chargesService.findById = jest.fn().mockResolvedValue(makeCharge({ amount: 5000 }));
        paymentMethodsService.findById = jest.fn().mockResolvedValue(makeMethod('BANK_TRANSFER'));

        await service.confirmManual(REFUND_ID);

        expect(stateTransitionService.transitionCharge).toHaveBeenCalledWith(
          CHARGE_ID,
          'REFUNDED',
          expect.objectContaining({ reasonCode: 'FULLY_REFUNDED' }),
          'SUCCEEDED',
          expect.anything(),
        );
      });

      it('부분 환불 시 transitionCharge 호출하지 않음', async () => {
        const { service, chargesService, paymentMethodsService, stateTransitionService } = makeContext({
          charge: makeCharge({ amount: 10000 }),
          method: makeMethod('BANK_TRANSFER'),
          pendingRefund: makeInsertedRefund({ amount: 5000 }),
          succeededRefundedAmount: 5000, // 5000 < 10000
        });
        chargesService.findById = jest.fn().mockResolvedValue(makeCharge({ amount: 10000 }));
        paymentMethodsService.findById = jest.fn().mockResolvedValue(makeMethod('BANK_TRANSFER'));

        await service.confirmManual(REFUND_ID);

        expect(stateTransitionService.transitionCharge).not.toHaveBeenCalled();
      });
    });
  });

  describe('createByIntent — 복합결제: 남은 금액으로 계획·검증한 뒤 외부 결제 먼저, 포인트 마지막', () => {
    type LegOutcome = Refund['status'] | 'THROW';
    type ChargeSpec = { id: string; amount: number; type: string };

    /**
     * charge 여럿을 가진 intent. create() 는 charge 별 결과(outcome)를 돌려주는 가짜로 바꾼다 —
     * 여기서 보는 것은 «무엇을 어떤 순서로 얼마씩 부르는가»이고, create() 자체의 계약은 위 블록들이 지킨다.
     */
    function makeMultiChargeContext(opts: {
      charges: ChargeSpec[];
      refunded?: Record<string, number>; // charge 별 SUCCEEDED+PENDING 환불 합
      outcomes?: Record<string, LegOutcome>;
    }) {
      const ctx = makeContext({
        refundableCharges: opts.charges.map((c) =>
          makeCharge({ id: c.id, amount: c.amount, paymentMethodId: `pm-${c.id}` }),
        ),
      });
      ctx.paymentMethodsService.findById.mockImplementation(async (pmId: string) => {
        const c = opts.charges.find((x) => `pm-${x.id}` === pmId);
        return c ? { id: pmId, type: c.type, providerData: {} } : null;
      });
      const refundedTotals = jest
        .spyOn(ctx.service as any, 'getActiveRefundedTotalsByCharge')
        .mockResolvedValue(new Map(Object.entries(opts.refunded ?? {})));

      const calls: Array<{ chargeId: string; amount: number }> = [];
      const createSpy = jest.spyOn(ctx.service, 'create').mockImplementation(async (dto) => {
        calls.push({ chargeId: dto.chargeId, amount: dto.amount });
        const outcome = opts.outcomes?.[dto.chargeId] ?? 'SUCCEEDED';
        if (outcome === 'THROW') throw new Error(`boom:${dto.chargeId}`);
        const row: Refund = {
          id: `rf-${dto.chargeId}`,
          chargeId: dto.chargeId,
          intentId: INTENT_ID,
          amount: dto.amount,
          currency: 'KRW',
          status: outcome,
          reasonCode: null,
          reasonMessage: null,
          providerRefundId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return row;
      });
      const errorLog = jest.spyOn((ctx.service as any).logger, 'error').mockImplementation(() => undefined);
      return { ...ctx, calls, createSpy, errorLog, refundedTotals };
    }

    function manualReconcileLog(errorLog: jest.SpyInstance): string | undefined {
      const call = errorLog.mock.calls.find((c) => String(c[0]).includes('수동 대사'));
      return call ? String(call[0]) : undefined;
    }

    async function catchResponse(p: Promise<unknown>): Promise<Record<string, unknown>> {
      try {
        await p;
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        return (e as BadRequestException).getResponse() as Record<string, unknown>;
      }
      throw new Error('expected rejection');
    }

    // createdAt 순서: 포인트가 먼저 생긴다(실제 checkout 순서). 실행 순서는 그와 무관하게 외부 결제가 먼저다.
    const POINTS_THEN_CARD: ChargeSpec[] = [
      { id: 'P1', amount: 3000, type: 'POINTS' },
      { id: 'C1', amount: 7000, type: 'TOSS' },
    ];

    it('전액: 카드를 먼저, 포인트를 마지막에 — 비례 분할, 합 = 요청액', async () => {
      const { service, calls } = makeMultiChargeContext({ charges: POINTS_THEN_CARD });

      const result = await service.createByIntent(INTENT_ID, { amount: 10000 });

      expect(calls).toEqual([
        { chargeId: 'C1', amount: 7000 },
        { chargeId: 'P1', amount: 3000 },
      ]);
      expect(result.map((r) => r.id)).toEqual(['rf-C1', 'rf-P1']);
    });

    it('앞선 비례 부분환불 뒤의 부분환불은 «남은 금액»으로 나눈다 (옛 원금 분할과 같은 결과)', async () => {
      // 앞서 3000 을 비례(포인트 900 / 카드 2100)로 환불 → 남은 2100 / 4900
      const { service, calls, refundedTotals } = makeMultiChargeContext({
        charges: POINTS_THEN_CARD,
        refunded: { P1: 900, C1: 2100 },
      });

      await service.createByIntent(INTENT_ID, { amount: 3000 });

      expect(refundedTotals).toHaveBeenCalledWith(['P1', 'C1']);
      expect(calls).toEqual([
        { chargeId: 'C1', amount: 2100 },
        { chargeId: 'P1', amount: 900 },
      ]);
    });

    it('관리자가 카드 charge 만 따로 환불한 뒤: 각 leg 의 몫이 그 leg 의 남은 금액을 넘지 않는다', async () => {
      // 남은: 포인트 3000, 카드 2000. 옛 원금 분할이면 카드 몫 2800 > 2000 → 포인트가 나간 뒤 400.
      const { service, calls } = makeMultiChargeContext({ charges: POINTS_THEN_CARD, refunded: { C1: 5000 } });

      await service.createByIntent(INTENT_ID, { amount: 4000 });

      expect(calls).toEqual([
        { chargeId: 'C1', amount: 1600 },
        { chargeId: 'P1', amount: 2400 },
      ]);
    });

    it('남은 금액 합보다 큰 요청은 돈을 움직이기 전에 REFUND_AMOUNT_EXCEEDS_TOTAL', async () => {
      const { service, createSpy, provider } = makeMultiChargeContext({
        charges: POINTS_THEN_CARD,
        refunded: { C1: 5000 },
      });

      const response = await catchResponse(service.createByIntent(INTENT_ID, { amount: 6000 }));

      expect(response.error).toBe('REFUND_AMOUNT_EXCEEDS_TOTAL');
      expect(String(response.message)).toContain('5000');
      expect(createSpy).not.toHaveBeenCalled();
      expect(provider.refund).not.toHaveBeenCalled();
    });

    it('남은 금액이 0 인 charge 는 계획에서 빠진다', async () => {
      const { service, calls } = makeMultiChargeContext({ charges: POINTS_THEN_CARD, refunded: { C1: 7000 } });

      await service.createByIntent(INTENT_ID, { amount: 3000 });

      expect(calls).toEqual([{ chargeId: 'P1', amount: 3000 }]);
    });

    it('카드가 FAILED 면 포인트는 부르지 않고 [FAILED 카드 행] 만 돌려준다', async () => {
      const { service, calls, errorLog } = makeMultiChargeContext({
        charges: POINTS_THEN_CARD,
        outcomes: { C1: 'FAILED' },
      });

      const result = await service.createByIntent(INTENT_ID, { amount: 10000 });

      expect(calls).toEqual([{ chargeId: 'C1', amount: 7000 }]);
      expect(result.map((r) => [r.id, r.status])).toEqual([['rf-C1', 'FAILED']]);
      // 아무 돈도 안 나갔다 — 수동 대사 대상이 아니다
      expect(manualReconcileLog(errorLog)).toBeUndefined();
    });

    it('카드 SUCCEEDED 뒤 포인트 FAILED → 두 행을 돌려주고 수동 대사 error 로그', async () => {
      const { service, errorLog } = makeMultiChargeContext({
        charges: POINTS_THEN_CARD,
        outcomes: { P1: 'FAILED' },
      });

      const result = await service.createByIntent(INTENT_ID, { amount: 10000 });

      expect(result.map((r) => [r.id, r.status])).toEqual([
        ['rf-C1', 'SUCCEEDED'],
        ['rf-P1', 'FAILED'],
      ]);
      const message = manualReconcileLog(errorLog);
      expect(message).toContain(INTENT_ID);
      expect(message).toContain('rf-C1:7000:SUCCEEDED');
      expect(message).toContain('P1');
    });

    it('앞 leg 가 나간 뒤 다음 leg 가 throw → 다시 던지고, 나간 leg 를 error 로그에 남긴다', async () => {
      const { service, errorLog } = makeMultiChargeContext({
        charges: POINTS_THEN_CARD,
        outcomes: { P1: 'THROW' },
      });

      await expect(service.createByIntent(INTENT_ID, { amount: 10000 })).rejects.toThrow('boom:P1');

      const message = manualReconcileLog(errorLog);
      expect(message).toContain('rf-C1:7000:SUCCEEDED');
      expect(message).toContain('boom:P1');
    });

    it('첫 leg 가 throw 하면 그대로 다시 던지고 뒤 leg 는 부르지 않는다', async () => {
      const { service, calls, errorLog } = makeMultiChargeContext({
        charges: POINTS_THEN_CARD,
        outcomes: { C1: 'THROW' },
      });

      await expect(service.createByIntent(INTENT_ID, { amount: 10000 })).rejects.toThrow('boom:C1');
      expect(calls).toEqual([{ chargeId: 'C1', amount: 7000 }]);
      expect(manualReconcileLog(errorLog)).toBeUndefined();
    });

    it('무통장 PENDING 은 나간 것으로 보고 포인트로 이어 간다', async () => {
      const { service, calls } = makeMultiChargeContext({
        charges: [
          { id: 'P1', amount: 3000, type: 'POINTS' },
          { id: 'B1', amount: 7000, type: 'BANK_TRANSFER' },
        ],
        outcomes: { B1: 'PENDING' },
      });

      const result = await service.createByIntent(INTENT_ID, { amount: 10000 });

      expect(calls.map((c) => c.chargeId)).toEqual(['B1', 'P1']);
      expect(result.map((r) => r.status)).toEqual(['PENDING', 'SUCCEEDED']);
    });

    it('효성 CMS leg 가 계획에 있으면 어떤 환불도 하기 전에 400 REFUND_NOT_AUTOMATABLE', async () => {
      const { service, createSpy } = makeMultiChargeContext({
        charges: [
          { id: 'P1', amount: 3000, type: 'POINTS' },
          { id: 'M1', amount: 7000, type: 'CMS_BATCH' },
        ],
      });

      const response = await catchResponse(service.createByIntent(INTENT_ID, { amount: 10000 }));

      expect(response.error).toBe('REFUND_NOT_AUTOMATABLE');
      expect(String(response.message)).toContain('CMS_BATCH');
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('효성 CMS 단독 결제도 FAILED 행을 만들지 않고 400 REFUND_NOT_AUTOMATABLE', async () => {
      const { service, createSpy } = makeMultiChargeContext({
        charges: [{ id: 'M1', amount: 10000, type: 'CMS_BATCH' }],
      });

      const response = await catchResponse(service.createByIntent(INTENT_ID, { amount: 10000 }));

      expect(response.error).toBe('REFUND_NOT_AUTOMATABLE');
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('몫이 0 인 leg 는 부르지 않는다', async () => {
      const { service, calls } = makeMultiChargeContext({ charges: POINTS_THEN_CARD });

      await service.createByIntent(INTENT_ID, { amount: 1 });

      expect(calls).toEqual([{ chargeId: 'C1', amount: 1 }]);
    });

    it('반올림이 마지막 leg 의 남은 금액을 넘기면 넘친 만큼 앞 leg 로 옮긴다 (4-way)', async () => {
      // 남은 [2,2,2,1], 요청 5 → Math.round 몫 [1,1,1] + 마지막 2 > 1
      const { service, calls } = makeMultiChargeContext({
        charges: [
          { id: 'A', amount: 2, type: 'TOSS' },
          { id: 'B', amount: 2, type: 'TOSS' },
          { id: 'C', amount: 2, type: 'TOSS' },
          { id: 'D', amount: 1, type: 'TOSS' },
        ],
      });

      await service.createByIntent(INTENT_ID, { amount: 5 });

      expect(calls).toEqual([
        { chargeId: 'A', amount: 2 },
        { chargeId: 'B', amount: 1 },
        { chargeId: 'C', amount: 1 },
        { chargeId: 'D', amount: 1 },
      ]);
    });
  });

  describe('splitRefundOverRemaining', () => {
    const legs = (...remaining: number[]) => remaining.map((r) => ({ remaining: r }));

    it('남은 금액 비례 + Math.round, 마지막 leg 가 나머지를 흡수한다 (기존 정책)', () => {
      expect(splitRefundOverRemaining(legs(3000, 7000), 10000)).toEqual([3000, 7000]);
      expect(splitRefundOverRemaining(legs(3000, 7000), 3333)).toEqual([1000, 2333]);
      expect(splitRefundOverRemaining(legs(1, 1, 1), 2)).toEqual([1, 1, 0]);
    });

    it('마지막 몫이 남은 금액을 넘으면 잘라서 앞에서부터 여유 있는 leg 로 옮긴다', () => {
      expect(splitRefundOverRemaining(legs(2, 2, 2, 1), 5)).toEqual([2, 1, 1, 1]);
    });

    it('마지막 몫이 음수가 되면 0 으로 자르고 뒤에서부터 덜어낸다', () => {
      // Math.round(0.5)=1 이 세 번 → 마지막 = 2 - 3 = -1. 옛 코드는 이 leg 를 건너뛰고 3 을 환불했다(과환불).
      expect(splitRefundOverRemaining(legs(1, 1, 1, 1), 2)).toEqual([1, 1, 0, 0]);
    });

    it('어떤 입력에서도 합 = 요청액, 0 ≤ 몫 ≤ 남은 금액', () => {
      const violations: string[] = [];
      for (let a = 1; a <= 6; a++)
        for (let b = 1; b <= 6; b++)
          for (let c = 1; c <= 6; c++)
            for (let d = 1; d <= 6; d++) {
              const rem = [a, b, c, d];
              const total = a + b + c + d;
              for (let amount = 0; amount <= total; amount++) {
                const shares = splitRefundOverRemaining(legs(...rem), amount);
                const sum = shares.reduce((s, x) => s + x, 0);
                if (sum !== amount || shares.some((s, i) => s < 0 || s > rem[i] || !Number.isInteger(s))) {
                  violations.push(`${JSON.stringify(rem)} ${amount} → ${JSON.stringify(shares)}`);
                }
              }
            }
      expect(violations).toEqual([]);
    });
  });
});
