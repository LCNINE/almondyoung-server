import { format, subDays } from 'date-fns';
import { InvoiceOutcomeHandler } from './invoice-outcome.handler';
import { MembershipBenefitUsage } from '../benefit/benefit-usage';

/**
 * 미수(외상) 원장이 «자격 회수와 같은 트랜잭션에서» 정확히 한 줄 생기는지 못 박는다.
 * 자격을 들고 있었으면 적고, 아예 없었거나 그 주기를 못 덮었으면 안 적는다. 그리고 돈을 냈다면
 * 청약철회로 전액 환불받았을 주기(7일 안 · 혜택 미사용)에는 적지 않는다.
 */
function makeHandler(opts: {
  contract?: Record<string, unknown> | null;
  heldEntitlement?: { startsAt: string; endsAt: string } | null;
  plan?: { price: number; currency: string } | null;
  usage?: MembershipBenefitUsage;
  newRules?: boolean;
}) {
  const contract = opts.contract ?? {
    userId: 'u1',
    status: 'ACTIVE',
    autoRenewal: true,
    billingPath: 'INVOICE',
    nextBillingDate: '2026-07-07',
    recurringCancelledAt: null,
  };

  // limit() 이 도착하는 순서대로 돌려준다: ①계약 ②보유 자격 ③플랜(폴백일 때만)
  const selectQueue: unknown[][] = [
    contract ? [contract] : [],
    opts.heldEntitlement ? [opts.heldEntitlement] : [],
    opts.plan ? [opts.plan] : [],
  ];

  const tx = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockImplementation(() => Promise.resolve(selectQueue.shift() ?? [])),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    insert: jest.fn().mockImplementation(() => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: 'marker-1' }]) }),
        returning: () => Promise.resolve([{ id: 'batch-1' }]),
        then: (resolve: (v: unknown) => unknown) => resolve(undefined),
      }),
    })),
  };
  // 트랜잭션 밖의 best-effort 후처리(약정 정리)가 db 를 직접 읽는다 — 빈 결과로 채워 노이즈를 없앤다.
  const db = {
    transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
  };
  const contractEventManager = { addEvent: jest.fn().mockResolvedValue(undefined) };
  const publisher = { publishStatusChanged: jest.fn().mockResolvedValue(undefined) };
  const paymentClient = {
    terminateBillingMandate: jest
      .fn()
      .mockResolvedValue({ agreementFound: false, mandateTerminated: false, cancelledWithdrawals: 0 }),
  };
  const arrearsManager = {
    record: jest.fn().mockResolvedValue(true),
    outstandingTotal: jest.fn().mockResolvedValue(0),
  };
  const benefitReader = {
    findMembershipBenefitUsageSince: jest
      .fn()
      .mockResolvedValue(opts.usage ?? { totalDiscountAmount: 0, orderCount: 0, welcomeDeal: false }),
  };
  const termsRulesReader = { newRulesApply: jest.fn().mockResolvedValue(opts.newRules ?? true) };

  const handler = new InvoiceOutcomeHandler(
    { db } as never,
    contractEventManager as never,
    publisher as never,
    paymentClient as never,
    arrearsManager as never,
    benefitReader as never,
    termsRulesReader as never,
  );
  return { handler, arrearsManager, contractEventManager };
}

const COVERING = { startsAt: '2026-07-07', endsAt: '2026-08-07' };
const BILLED = { amount: 4990, currency: 'KRW', periodStart: '2026-07-07', periodEnd: '2026-08-07' };

describe('인보이스 터미널 실패 → 미수 원장', () => {
  it('UNCOLLECTIBLE: 인보이스 금액 그대로 적는다', async () => {
    const { handler, arrearsManager } = makeHandler({ heldEntitlement: COVERING });
    await handler.handleUncollectible('c1', 'inv-1', 'Q301', BILLED);

    expect(arrearsManager.record).toHaveBeenCalledTimes(1);
    expect(arrearsManager.record.mock.calls[0][1]).toMatchObject({
      userId: 'u1',
      contractId: 'c1',
      invoiceRef: 'inv-1',
      cause: 'UNCOLLECTIBLE',
      causeCode: 'Q301',
      amount: 4990,
      amountSource: 'INVOICE',
      periodEnd: '2026-08-07',
    });
  });

  it('MANDATE_REJECTED: 심사 거절도 미수다 — 출금 시도가 0회여도 자격은 썼다', async () => {
    const { handler, arrearsManager } = makeHandler({ heldEntitlement: COVERING });
    await handler.handleMandateRejected('c1', 'inv-1', 'Q201', BILLED);

    expect(arrearsManager.record).toHaveBeenCalledTimes(1);
    expect(arrearsManager.record.mock.calls[0][1]).toMatchObject({
      cause: 'MANDATE_REJECTED',
      causeCode: 'Q201',
      amount: 4990,
    });
  });

  it('심사 기한초과는 별도 상태가 아니라 사유 코드로만 남는다', async () => {
    const { handler, arrearsManager } = makeHandler({ heldEntitlement: COVERING });
    await handler.handleMandateRejected('c1', 'inv-1', 'MANDATE_TIMEOUT', BILLED);
    expect(arrearsManager.record.mock.calls[0][1]).toMatchObject({
      cause: 'MANDATE_REJECTED',
      causeCode: 'MANDATE_TIMEOUT',
    });
  });

  it('자격을 한 번도 안 받았으면 미수를 안 적는다 — 공짜로 쓴 것이 없다', async () => {
    const { handler, arrearsManager } = makeHandler({ heldEntitlement: null });
    await handler.handleUncollectible('c1', 'inv-1', 'Q301', BILLED);
    expect(arrearsManager.record).not.toHaveBeenCalled();
  });

  it('자격이 청구 주기를 못 덮으면 미수를 안 적는다 — 선적용이 걸린 적 없는 주기다', async () => {
    const { handler, arrearsManager } = makeHandler({ heldEntitlement: { startsAt: '2026-06-07', endsAt: '2026-07-07' } });
    await handler.handleUncollectible('c1', 'inv-1', 'Q301', BILLED);
    expect(arrearsManager.record).not.toHaveBeenCalled();
  });

  it('인보이스 행 없이 거절되면 플랜가로 유도하고 그 사실을 남긴다', async () => {
    const { handler, arrearsManager } = makeHandler({
      heldEntitlement: COVERING,
      plan: { price: 4990, currency: 'KRW' },
    });
    await handler.handleMandateRejected('c1', null, 'BILLING_METHOD_NOT_ACTIVE');

    expect(arrearsManager.record).toHaveBeenCalledTimes(1);
    expect(arrearsManager.record.mock.calls[0][1]).toMatchObject({
      invoiceRef: 'mandate-rejected:c1',
      amount: 4990,
      amountSource: 'PLAN_FALLBACK',
      periodEnd: null,
    });
  });

  it('금액을 끝내 못 정하면 미수를 안 적는다 — 0원 빚을 만들지 않는다', async () => {
    const { handler, arrearsManager } = makeHandler({ heldEntitlement: COVERING, plan: null });
    await handler.handleMandateRejected('c1', null, 'BILLING_METHOD_NOT_ACTIVE');
    expect(arrearsManager.record).not.toHaveBeenCalled();
  });

  it('원장에 새로 적혔을 때만 감사 이벤트를 남긴다', async () => {
    const { handler, contractEventManager } = makeHandler({ heldEntitlement: COVERING });
    await handler.handleUncollectible('c1', 'inv-1', 'Q301', BILLED);

    // addEvent(tx, contractId, eventType, metadata, causedBy, userId) — eventType 은 3번째 인자다.
    const types = contractEventManager.addEvent.mock.calls.map((c) => c[2]);
    expect(types).toContain('ARREARS_RECORDED');
  });

  describe('청약철회 대상 주기에는 적지 않는다 — 환불 기준과 같은 줄', () => {
    const day = (n: number) => format(subDays(new Date(), n), 'yyyy-MM-dd');
    const recent = () => ({ amount: 4990, currency: 'KRW', periodStart: day(2), periodEnd: day(-28) });
    const recentHeld = () => ({ startsAt: day(2), endsAt: day(-28) });
    const skippedReason = (addEvent: jest.Mock) =>
      addEvent.mock.calls.find((c) => c[2] === 'ARREARS_SKIPPED')?.[3]?.reason;

    it('7일 안 · 혜택 미사용: 적지 않고 이유를 계약 이벤트로 남긴다', async () => {
      const { handler, arrearsManager, contractEventManager } = makeHandler({ heldEntitlement: recentHeld() });
      await handler.handleMandateRejected('c1', 'inv-1', 'Q201', recent());

      expect(arrearsManager.record).not.toHaveBeenCalled();
      expect(skippedReason(contractEventManager.addEvent)).toBe('WITHDRAWAL_ELIGIBLE');
    });

    it('7일 안이라도 멤버십 할인을 받았으면 적는다', async () => {
      const { handler, arrearsManager } = makeHandler({
        heldEntitlement: recentHeld(),
        usage: { totalDiscountAmount: 1500, orderCount: 1, welcomeDeal: false },
      });
      await handler.handleMandateRejected('c1', 'inv-1', 'Q201', recent());
      expect(arrearsManager.record).toHaveBeenCalledTimes(1);
    });

    it('7일 안이라도 웰컴딜을 샀으면 적는다', async () => {
      const { handler, arrearsManager } = makeHandler({
        heldEntitlement: recentHeld(),
        usage: { totalDiscountAmount: 0, orderCount: 0, welcomeDeal: true },
      });
      await handler.handleMandateRejected('c1', 'inv-1', 'Q201', recent());
      expect(arrearsManager.record).toHaveBeenCalledTimes(1);
    });

    it('혜택을 안 썼어도 7일이 지났으면 적는다 — 정상 납부자도 그 주기는 환불받지 못한다', async () => {
      const { handler, arrearsManager } = makeHandler({
        heldEntitlement: { startsAt: day(10), endsAt: day(-20) },
      });
      await handler.handleUncollectible('c1', 'inv-1', 'Q301', {
        amount: 4990,
        currency: 'KRW',
        periodStart: day(10),
        periodEnd: day(-20),
      });
      expect(arrearsManager.record).toHaveBeenCalledTimes(1);
    });
  });

  it('새 약관이 적용되지 않는 기존 회원에게는 적지 않는다 — 고지·적용일 전', async () => {
    const { handler, arrearsManager, contractEventManager } = makeHandler({
      heldEntitlement: COVERING,
      newRules: false,
    });
    await handler.handleUncollectible('c1', 'inv-1', 'Q301', BILLED);

    expect(arrearsManager.record).not.toHaveBeenCalled();
    expect(
      contractEventManager.addEvent.mock.calls.find((c) => c[2] === 'ARREARS_SKIPPED')?.[3]?.reason,
    ).toBe('TERMS_NOT_IN_FORCE');
  });
});
