import { addDays } from 'date-fns';
import { CancellationPolicyInput, RefundPolicyService } from '../refund-policy.service';

/**
 * 연간 환불 정책의 수치를 고정한다.
 *
 * 환불액 = 49,900 − (경과 개월 × 4,990) − 기간 내 할인 혜택액
 * 10개월(=49,900/4,990) 경과 후 0원이 되어 '연간 2개월 무료' 혜택이 정확히 회수된다.
 */
describe('RefundPolicyService', () => {
  const policy = new RefundPolicyService();

  const MONTHLY_PRICE = 4990;
  const ANNUAL_PRICE = 49900;

  function input(overrides: Partial<CancellationPolicyInput> = {}): CancellationPolicyInput {
    const now = new Date('2026-07-30T00:00:00.000Z');
    return {
      now,
      isRecurring: true,
      plan: { price: MONTHLY_PRICE, durationDays: 30 },
      monthlyListPrice: MONTHLY_PRICE,
      paidPeriodStart: addDays(now, -1),
      periodEndsAt: addDays(now, 29),
      hasPayment: true,
      autoRefundSupported: true,
      requiresReceiveAccount: false,
      currentCycleBenefit: { orderCount: 0, totalDiscountAmount: 0 },
      termBenefitDiscount: 0,
      ...overrides,
    };
  }

  describe('연간 중도해지 정산', () => {
    it.each([
      [0, 1, 44910],
      [29, 1, 44910],
      [30, 1, 44910],
      [31, 2, 39920],
      [75, 3, 34930],
      [180, 6, 19960],
      [270, 9, 4990],
      [300, 10, 0],
      [310, 11, 0],
      [364, 13, 0],
    ])('경과 %i일 → %i개월 차감, 환불 %i원', (daysElapsed, expectedMonths, expectedRefund) => {
      const result = policy.calculateAnnualProration({
        paidAmount: ANNUAL_PRICE,
        monthlyListPrice: MONTHLY_PRICE,
        daysElapsed,
        benefitDiscount: 0,
      });

      expect(result.breakdown.monthsElapsed).toBe(expectedMonths);
      expect(result.refundAmount).toBe(expectedRefund);
    });

    it('사용한 할인 혜택액을 추가로 차감한다', () => {
      const result = policy.calculateAnnualProration({
        paidAmount: ANNUAL_PRICE,
        monthlyListPrice: MONTHLY_PRICE,
        daysElapsed: 75,
        benefitDiscount: 12000,
      });

      expect(result.refundAmount).toBe(34930 - 12000);
      expect(result.breakdown.benefitDeduction).toBe(12000);
    });

    it('차감액이 결제액을 넘어도 음수가 되지 않는다', () => {
      const result = policy.calculateAnnualProration({
        paidAmount: ANNUAL_PRICE,
        monthlyListPrice: MONTHLY_PRICE,
        daysElapsed: 200,
        benefitDiscount: 999999,
      });

      expect(result.refundAmount).toBe(0);
    });
  });

  describe('청약철회 창 (월간)', () => {
    it('7일 내 + 혜택 미사용이면 전액 환불', () => {
      const decision = policy.evaluate(input({ paidPeriodStart: addDays(new Date('2026-07-30'), -7) }));

      expect(decision.immediateRefund.available).toBe(true);
      expect(decision.immediateRefund.refundKind).toBe('WITHDRAWAL_FULL');
      expect(decision.immediateRefund.refundAmount).toBe(MONTHLY_PRICE);
      expect(decision.recommendedMode).toBe('IMMEDIATE_REFUND');
    });

    it('8일째부터는 환불 불가', () => {
      const decision = policy.evaluate(input({ paidPeriodStart: addDays(new Date('2026-07-30'), -8) }));

      expect(decision.immediateRefund.available).toBe(false);
      expect(decision.immediateRefund.refundAmount).toBe(0);
      expect(decision.recommendedMode).toBe('AT_PERIOD_END');
      expect(decision.withdrawalDaysRemaining).toBe(0);
    });

    it('혜택을 한 번이라도 썼으면 7일 내라도 환불 불가', () => {
      const decision = policy.evaluate(input({ currentCycleBenefit: { orderCount: 1, totalDiscountAmount: 0 } }));

      expect(decision.immediateRefund.available).toBe(false);
      expect(decision.immediateRefund.unavailableReason).toContain('혜택');
    });

    it('할인 금액만 있고 주문 수가 0이어도 사용으로 본다', () => {
      const decision = policy.evaluate(input({ currentCycleBenefit: { orderCount: 0, totalDiscountAmount: 1 } }));

      expect(decision.immediateRefund.available).toBe(false);
    });

    it('남은 철회 기간을 알려준다', () => {
      const decision = policy.evaluate(input({ paidPeriodStart: addDays(new Date('2026-07-30'), -2) }));

      expect(decision.withdrawalDaysRemaining).toBe(5);
    });
  });

  describe('환불 집행 경로', () => {
    it('자동환불이 불가한 수단은 MANUAL + 계좌 필수', () => {
      const decision = policy.evaluate(input({ autoRefundSupported: false }));

      expect(decision.immediateRefund.available).toBe(true);
      expect(decision.immediateRefund.refundExecution).toBe('MANUAL');
      expect(decision.immediateRefund.requiresReceiveAccount).toBe(true);
    });

    it('무통장은 자동환불이라도 수취 계좌가 필요하다', () => {
      const decision = policy.evaluate(input({ requiresReceiveAccount: true }));

      expect(decision.immediateRefund.refundExecution).toBe('AUTO');
      expect(decision.immediateRefund.requiresReceiveAccount).toBe(true);
    });

    it('결제 내역이 없으면(트라이얼 중) 즉시해지 환불 대상이 아니다', () => {
      const decision = policy.evaluate(input({ hasPayment: false, paidPeriodStart: null }));

      expect(decision.immediateRefund.available).toBe(false);
      expect(decision.immediateRefund.unavailableReason).toContain('결제 내역');
    });
  });

  describe('해지예약', () => {
    it('항상 선택할 수 있고 이용 종료일은 현재 주기 종료일이다', () => {
      const decision = policy.evaluate(input({ periodEndsAt: new Date('2026-08-28') }));

      expect(decision.atPeriodEnd.available).toBe(true);
      expect(decision.atPeriodEnd.refundAmount).toBe(0);
      expect(decision.atPeriodEnd.effectiveEndsAt).toBe('2026-08-28');
    });
  });

  describe('resolvePaidPeriodStart', () => {
    it('종료일에서 플랜 기간을 뺀 값이 이번 주기 시작 (갱신 시 startsAt 은 원 가입일이라 못 쓴다)', () => {
      const start = policy.resolvePaidPeriodStart({
        periodEndsAt: new Date('2026-08-28'),
        durationDays: 30,
        hasPayment: true,
      });

      expect(start && start.toISOString().slice(0, 10)).toBe('2026-07-29');
    });

    it('결제가 없으면 null', () => {
      expect(
        policy.resolvePaidPeriodStart({ periodEndsAt: new Date('2026-08-28'), durationDays: 30, hasPayment: false }),
      ).toBeNull();
    });
  });
});
