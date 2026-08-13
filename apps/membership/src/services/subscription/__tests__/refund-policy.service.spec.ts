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
      pausedDaysInPeriod: 0,
      periodEndsAt: addDays(now, 29),
      pausedDaysAccrued: 0,
      hasPayment: true,
      // 미수금 대기 여부. 계약상 필수인데 기본 픽스처가 안 채우고 있었다 —
      // 청약철회 창 판정(274·284행)의 입력이라 기본값은 '아님'.
      awaitingCollection: false,
      autoRefundSupported: true,
      requiresReceiveAccount: false,
      refundableAmount: null,
      currentPeriodBenefit: { orderCount: 0, totalDiscountAmount: 0 },
      termBenefitDiscount: 0,
      ...overrides,
    };
  }

  describe('일시정지 보정', () => {
    it('정지 기간은 이용 기간으로 세지 않는다 (혜택을 쓸 수 없었던 기간)', () => {
      const now = new Date('2026-07-30T00:00:00.000Z');
      const base = {
        plan: { price: ANNUAL_PRICE, durationDays: 365 },
        paidPeriodStart: addDays(now, -75),
        periodEndsAt: addDays(now, 290),
        currentPeriodBenefit: { orderCount: 1, totalDiscountAmount: 1000 },
      };

      // 75일 경과 → 3개월 차감(34,930원). 그중 40일이 정지였다면 35일 이용 → 2개월 차감(39,920원).
      expect(policy.evaluate(input({ ...base, now })).immediateRefund.refundAmount).toBe(34930);
      expect(
        policy.evaluate(input({ ...base, now, pausedDaysInPeriod: 40 })).immediateRefund.refundAmount,
      ).toBe(39920);
    });
  });

  describe('실제 환불 가능액 상한', () => {
    it('이미 일부가 환불된 결제면 정책액이 남은 환불 가능액으로 잘린다', () => {
      const decision = policy.evaluate(input({ refundableAmount: 2000 }));

      // 7일 내 + 혜택 미사용이라 정책상 전액(4,990)이지만 wallet 이 2,000 만 환불할 수 있다.
      expect(decision.immediateRefund.refundAmount).toBe(2000);
    });

    it('환불 가능액을 알 수 없으면(조회 실패) 정책액을 그대로 쓴다', () => {
      expect(policy.evaluate(input({ refundableAmount: null })).immediateRefund.refundAmount).toBe(MONTHLY_PRICE);
    });
  });

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

    it('할인을 1원이라도 받았으면 7일 내라도 환불 불가', () => {
      const decision = policy.evaluate(input({ currentPeriodBenefit: { orderCount: 1, totalDiscountAmount: 1 } }));

      expect(decision.immediateRefund.available).toBe(false);
      expect(decision.immediateRefund.unavailableReason).toContain('혜택');
    });

    it('주문은 했지만 멤버십 할인이 0원이면 혜택 미사용 — 전액 환불', () => {
      const decision = policy.evaluate(input({ currentPeriodBenefit: { orderCount: 3, totalDiscountAmount: 0 } }));

      expect(decision.immediateRefund.available).toBe(true);
      expect(decision.immediateRefund.refundKind).toBe('WITHDRAWAL_FULL');
      expect(decision.withdrawalDaysRemaining).toBeGreaterThan(0);
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

    // 정지 중에는 종료일이 동결돼 있고 재개 시점에 정지 일수만큼 연장된다. 동결된 날짜를 그대로
    // 안내하면 이미 쌓인 정지 일수를 떼먹는 안내가 된다.
    it('정지 중이면 아직 반영되지 않은 정지 일수를 더한 날짜를 보여준다', () => {
      const decision = policy.evaluate(input({ periodEndsAt: new Date('2026-08-28'), pausedDaysAccrued: 6 }));

      expect(decision.atPeriodEnd.effectiveEndsAt).toBe('2026-09-03');
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

    // 역산은 endsAt 을 미는 모든 경로(관리자 기간 조정·정지 재개)에서 함께 밀려 지난 청약철회 창을
    // 되살린다. 계약에 기록된 최초 결제일보다 뒤로는 가지 않게 자른다.
    it('계약의 최초 결제일보다 뒤로는 가지 않는다 (지난 청약철회 창 부활 차단)', () => {
      const start = policy.resolvePaidPeriodStart({
        periodEndsAt: new Date('2026-08-28'),
        durationDays: 30,
        hasPayment: true,
        billingDate: new Date('2026-07-01'),
      });

      expect(start && start.toISOString().slice(0, 10)).toBe('2026-07-01');
    });

    // 결제 기록이 없는데 역산값과 최초 결제일이 크게 어긋난다면 갱신이 아니라 endsAt 이 밀린
    // 흔적이다. 이른 쪽(=청약철회가 닫히는 쪽)으로 잡는다 — 예외 환불 창구는 관리자에게 있다.
    it('최초 결제일이 역산값보다 이르면 그쪽으로 잘린다', () => {
      const start = policy.resolvePaidPeriodStart({
        periodEndsAt: new Date('2026-08-28'),
        durationDays: 30,
        hasPayment: true,
        billingDate: new Date('2026-01-01'),
      });

      expect(start && start.toISOString().slice(0, 10)).toBe('2026-01-01');
    });

    it('결제가 없으면 null', () => {
      expect(
        policy.resolvePaidPeriodStart({ periodEndsAt: new Date('2026-08-28'), durationDays: 30, hasPayment: false }),
      ).toBeNull();
    });
  });
});
