import { Injectable } from '@nestjs/common';
import { addDays, differenceInCalendarDays, format } from 'date-fns';

/** 해지 방식. 고객이 직접 고른다(서버가 강제 분기하지 않는다). */
export type CancellationMode = 'AT_PERIOD_END' | 'IMMEDIATE_REFUND';

export type RefundKind = 'NONE' | 'WITHDRAWAL_FULL' | 'ANNUAL_PRORATION' | 'PRE_COLLECTION_WITHDRAWAL';

/** 환불 집행 방식. MANUAL 은 PG 자동환불이 불가능해 관리자가 계좌로 송금해야 하는 건(효성 CMS 등). */
export type RefundExecution = 'NONE' | 'AUTO' | 'MANUAL';

/** 청약철회 창(일). 이 기간 안에 혜택을 하나도 안 썼으면 결제액 전액 환불. */
export const WITHDRAWAL_WINDOW_DAYS = 7;

/** 연간 플랜 판정 기준일수. 365 를 그대로 쓰지 않는 이유는 366/360 같은 변형 플랜도 연간으로 보기 위함. */
export const ANNUAL_PLAN_MIN_DURATION_DAYS = 180;

/** 연간 정산에서 1개월로 세는 일수. membership_cycle_benefits 의 집계주기(30일)와 같은 단위를 쓴다. */
export const MONTH_UNIT_DAYS = 30;

/** 환불 처리 안내 영업일수. 고객 문구·관리자 안내에 함께 쓴다. */
export const REFUND_PROCESSING_BUSINESS_DAYS = 3;

export interface AnnualProrationBreakdown {
  /** 실제 결제액 */
  paidAmount: number;
  /** 정산에 쓰는 월간 정가 */
  monthlyListPrice: number;
  /** 사용한 개월 수(시작월 포함, 30일 단위 올림) */
  monthsElapsed: number;
  /** 사용 기간 차감액 = monthsElapsed × monthlyListPrice (결제액 상한) */
  usageDeduction: number;
  /** 해당 기간에 실제로 받은 멤버십 할인 혜택 차감액 */
  benefitDeduction: number;
}

export interface CancellationOption {
  mode: CancellationMode;
  available: boolean;
  /** available=false 일 때 고객/관리자에게 보여줄 사유 */
  unavailableReason?: string;
  refundAmount: number;
  refundKind: RefundKind;
  refundExecution: RefundExecution;
  /** 환불 송금용 계좌 정보가 필요한지(무통장·수동송금 건) */
  requiresReceiveAccount: boolean;
  /** 이 방식을 택했을 때 멤버십 이용이 끝나는 날 (YYYY-MM-DD) */
  effectiveEndsAt: string;
  breakdown?: AnnualProrationBreakdown;
}

export interface CancellationPolicyInput {
  now: Date;
  /** 정기결제 계약인지(=자동갱신 대상). false 면 1회 결제. */
  isRecurring: boolean;
  plan: { price: number; durationDays: number };
  /** 동일 티어의 활성 월간 플랜 정가. 연간 중도해지 정산 기준. */
  monthlyListPrice: number;
  /** 이번 결제 주기의 시작 = 마지막 결제 성공 시각. 미결제(트라이얼 중)면 null. */
  paidPeriodStart: Date | null;
  /** 이번 주기 중 실제로 정지돼 있던 일수. 정지 중에는 혜택을 못 쓰므로 이용 기간에서 뺀다. */
  pausedDaysInPeriod: number;
  /** 현재 이용 종료일 (entitlement.endsAt) */
  periodEndsAt: Date;
  /**
   * 지금 정지 중이라면 아직 종료일에 반영되지 않은 정지 일수.
   *
   * 정지 중에는 endsAt 이 동결돼 있고 재개 시점에 실제 정지 일수만큼 연장된다. 해지 예약은 잔여
   * 기간을 다 쓰고 끝낸다는 뜻이므로, 이 일수를 더한 날짜가 실제 이용 종료일이다.
   */
  pausedDaysAccrued: number;
  /** 환불 대상 결제 intent 가 있는지 */
  hasPayment: boolean;
  /**
   * 자격은 선지급됐는데 아직 수금이 확정되지 않은 상태(효성 CMS 인보이스 경로).
   *
   * 돌려줄 돈은 없지만 **나갈 돈은 남아 있다.** 예정 출금을 지우면 애초에 나가지 않으므로,
   * 청약철회 창 안이고 혜택을 쓰지 않았다면 '결제 없이 즉시 종료'가 고객에게 가장 유리하다.
   * 혜택을 이미 썼다면 막는다 — 그건 무료 이용이 된다.
   */
  awaitingCollection: boolean;
  /** wallet 이 해당 결제를 PG 자동환불할 수 있는지. false 면 관리자 수동 송금. */
  autoRefundSupported: boolean;
  /** 무통장 등 환불 수취 계좌가 필요한 결제였는지 */
  requiresReceiveAccount: boolean;
  /**
   * wallet 이 아직 환불할 수 있는 금액(이미 환불된 금액 제외). 조회 실패면 null.
   *
   * 정책액은 플랜 정가로 계산되므로, 부분 환불이 이미 나갔거나 실제 결제액이 더 적은 계약에서는
   * 정책액이 실제로 돌려줄 수 있는 금액을 넘을 수 있다. 그 차액은 wallet 에서 실패하거나 과환불이
   * 되므로 상한으로 쓴다.
   */
  refundableAmount: number | null;
  /** 이번 결제 주기의 혜택 사용량 (청약철회 판정용) */
  currentCycleBenefit: { orderCount: number; totalDiscountAmount: number };
  /** 이번 결제 주기 전체에 받은 할인 합계 (연간 정산 차감용) */
  termBenefitDiscount: number;
}

export interface CancellationPolicyDecision {
  /** 정기결제 해지 예약 (잔여기간 이용 후 종료) */
  atPeriodEnd: CancellationOption;
  /** 즉시 해지 + 환불 */
  immediateRefund: CancellationOption;
  /** 기본 선택값 — 정책상 권장되는 방식 */
  recommendedMode: CancellationMode;
  /** 청약철회 창이 며칠 남았는지 (지났으면 0) */
  withdrawalDaysRemaining: number;
}

/**
 * 멤버십 해지·환불 정책 (Policy Layer)
 *
 * 이 클래스가 환불 정책의 **유일한** 소유자다. DB·HTTP 를 모르는 순수 계산기라
 * 고객 셀프해지·관리자 강제취소·미리보기(견적)가 모두 같은 판단을 공유한다.
 *
 * 정책 요약
 * - 월간(정기/1회): 이용 시작 후 환불 불가. 예외는 가입 7일 내 + 혜택 미사용(청약철회) 전액 환불뿐.
 *   정기결제는 해지예약(잔여기간 이용 후 자동결제 중단)이 기본.
 * - 연간: 12개월 유지를 전제로 2개월을 할인한 가격이므로, 중도해지 시 사용 기간을 **월간 정가**로
 *   재계산해 차감한다. 결과적으로 10개월(=연간가/월정가) 경과 후에는 환불액이 0이 되어
 *   '2개월 무료' 혜택이 정확히 회수된다.
 */
@Injectable()
export class RefundPolicyService {
  evaluate(input: CancellationPolicyInput): CancellationPolicyDecision {
    const nowDate = format(input.now, 'yyyy-MM-dd');
    // 정지 중이면 종료일이 동결돼 있다 — 해지 후 재개될 실제 종료일을 보여준다.
    const periodEnd = format(addDays(input.periodEndsAt, Math.max(0, input.pausedDaysAccrued)), 'yyyy-MM-dd');
    const isAnnual = input.plan.durationDays >= ANNUAL_PLAN_MIN_DURATION_DAYS;

    const atPeriodEnd: CancellationOption = {
      mode: 'AT_PERIOD_END',
      available: true,
      refundAmount: 0,
      refundKind: 'NONE',
      refundExecution: 'NONE',
      requiresReceiveAccount: false,
      effectiveEndsAt: periodEnd,
    };

    const daysSincePeriodStart = input.paidPeriodStart
      ? differenceInCalendarDays(input.now, input.paidPeriodStart)
      : null;
    const withinWithdrawalWindow = daysSincePeriodStart !== null && daysSincePeriodStart <= WITHDRAWAL_WINDOW_DAYS;
    const benefitUnused =
      input.currentCycleBenefit.orderCount === 0 && input.currentCycleBenefit.totalDiscountAmount === 0;
    const withdrawalDaysRemaining =
      daysSincePeriodStart === null ? 0 : Math.max(0, WITHDRAWAL_WINDOW_DAYS - daysSincePeriodStart);

    const immediateRefund = this.resolveImmediateOption({
      input,
      nowDate,
      isAnnual,
      daysSincePeriodStart,
      withinWithdrawalWindow,
      benefitUnused,
    });

    return {
      atPeriodEnd,
      immediateRefund,
      // 즉시해지는 잔여 이용권을 포기하는 선택이라, 돌려받거나(환불) 안 내게 되는(수금 전) 돈이
      // 있을 때만 권장한다. 수금 전 건은 환불액이 0이어도 이번 요금 청구가 사라지므로 유리하다.
      recommendedMode:
        immediateRefund.available &&
        (immediateRefund.refundAmount > 0 || immediateRefund.refundKind === 'PRE_COLLECTION_WITHDRAWAL')
          ? 'IMMEDIATE_REFUND'
          : 'AT_PERIOD_END',
      withdrawalDaysRemaining: benefitUnused ? withdrawalDaysRemaining : 0,
    };
  }

  /**
   * 연간 중도해지 정산액.
   *
   * 환불액 = 결제액 − (경과 개월수 × 월간 정가) − 해당 기간 할인 혜택액, 최소 0
   */
  calculateAnnualProration(params: {
    paidAmount: number;
    monthlyListPrice: number;
    daysElapsed: number;
    benefitDiscount: number;
  }): { refundAmount: number; breakdown: AnnualProrationBreakdown } {
    // 사용 첫날도 1개월로 센다(일할 계산이 아니라 '월 단위 정가 환산'이 정책이다).
    const monthsElapsed = Math.max(1, Math.ceil(Math.max(0, params.daysElapsed) / MONTH_UNIT_DAYS));
    const usageDeduction = Math.min(params.paidAmount, monthsElapsed * params.monthlyListPrice);
    const benefitDeduction = Math.max(0, params.benefitDiscount);
    const refundAmount = Math.max(0, params.paidAmount - usageDeduction - benefitDeduction);

    return {
      refundAmount,
      breakdown: {
        paidAmount: params.paidAmount,
        monthlyListPrice: params.monthlyListPrice,
        monthsElapsed,
        usageDeduction,
        benefitDeduction,
      },
    };
  }

  /**
   * 이번 결제 주기의 시작일 — **결제 기록이 없는 옛 계약 전용 폴백**.
   *
   * 원천은 billing_events(CHARGE_SUCCESS) 시각이다. 그 기록이 없을 때만 종료일에서 플랜 기간을 빼
   * 역산하는데, 이 값은 결제와 무관하게 endsAt 를 미는 경로(관리자 기간 조정, 일시정지 재개)에서
   * 함께 밀려 **이미 지난 청약철회 7일 창을 되살린다**.
   *
   * 그래서 계약에 기록된 최초 결제일(`billingDate`)보다 뒤로는 가지 않게 자른다. 결제 기록이 없는
   * 계약은 사실상 갱신을 겪지 않은 옛 계약이라 두 값이 같고, 어긋난다면 그건 결제가 아니라 관리자가
   * endsAt 를 민 흔적이므로 자르는 쪽이 맞다. 자름으로 인해 정당한 청약철회가 막히더라도
   * 관리자 예외 환불이라는 창구가 있지만, 반대 방향(정책 없이 전액 환불)은 되돌릴 방법이 없다.
   */
  resolvePaidPeriodStart(params: {
    periodEndsAt: Date;
    durationDays: number;
    hasPayment: boolean;
    billingDate?: Date | null;
  }): Date | null {
    if (!params.hasPayment) return null;
    const derived = addDays(params.periodEndsAt, -params.durationDays);
    if (!params.billingDate) return derived;
    return derived < params.billingDate ? derived : params.billingDate;
  }

  /**
   * 정책액을 wallet 이 실제로 환불할 수 있는 금액으로 자른다.
   *
   * 조회 실패(null)나 0(=수단을 특정할 수 없는 경우 포함)이면 자르지 않는다 — 알 수 없는 값으로
   * 환불을 막으면 정상 건까지 막힌다. 상한이 확인될 때만 낮춘다.
   */
  private capByRefundable(policyAmount: number, refundableAmount: number | null): number {
    if (refundableAmount === null || refundableAmount <= 0) return policyAmount;
    return Math.min(policyAmount, refundableAmount);
  }

  private resolveImmediateOption(params: {
    input: CancellationPolicyInput;
    nowDate: string;
    isAnnual: boolean;
    daysSincePeriodStart: number | null;
    withinWithdrawalWindow: boolean;
    benefitUnused: boolean;
  }): CancellationOption {
    const { input, nowDate, isAnnual, daysSincePeriodStart, withinWithdrawalWindow, benefitUnused } = params;

    // 집행 수단은 **환불 가능 여부와 다른 축이다.** 정책상 환불이 안 되는 계약이라도 관리자는 예외
    // 환불을 넣을 수 있고, 그 돈은 결제수단에 따라 PG 로 나가거나 사람이 계좌로 보내야 한다.
    // 여기서 비워두면 화면이 CMS 계약을 'PG 자동환불 가능' 으로 안내하고 계좌 입력도 띄우지 않아,
    // 관리자 예외 환불이 **보낼 곳 없는 수동 대기**로 떨어진다.
    const execution: RefundExecution = !input.hasPayment ? 'NONE' : input.autoRefundSupported ? 'AUTO' : 'MANUAL';
    const requiresReceiveAccount =
      input.hasPayment && (input.requiresReceiveAccount || execution === 'MANUAL');

    const base: CancellationOption = {
      mode: 'IMMEDIATE_REFUND',
      available: false,
      refundAmount: 0,
      refundKind: 'NONE',
      refundExecution: execution,
      requiresReceiveAccount,
      effectiveEndsAt: nowDate,
    };

    if (!input.hasPayment) {
      // 선지급 + 수금 전: 돌려줄 돈은 없지만 예정 출금을 지우면 나갈 돈도 없어진다.
      if (input.awaitingCollection && daysSincePeriodStart !== null && withinWithdrawalWindow && benefitUnused) {
        return {
          ...base,
          available: true,
          refundAmount: 0,
          refundKind: 'PRE_COLLECTION_WITHDRAWAL',
          refundExecution: 'NONE',
          requiresReceiveAccount: false,
        };
      }
      if (input.awaitingCollection && !benefitUnused) {
        return {
          ...base,
          unavailableReason:
            '이미 멤버십 혜택을 사용하셔서 이번 기간 요금은 예정대로 출금됩니다. ' +
            '해지 예약을 하시면 이번 기간까지 이용하신 뒤 종료되고, 다음 기간부터는 청구되지 않습니다.',
        };
      }
      return { ...base, unavailableReason: '환불 대상 결제 내역이 없습니다.' };
    }
    if (daysSincePeriodStart === null) {
      return { ...base, unavailableReason: '환불 대상 결제 내역이 없습니다.' };
    }

    // 1) 청약철회: 결제 후 7일 내 + 혜택 미사용 → 전액 환불
    if (withinWithdrawalWindow && benefitUnused) {
      return {
        ...base,
        available: true,
        refundAmount: this.capByRefundable(input.plan.price, input.refundableAmount),
        refundKind: 'WITHDRAWAL_FULL',
        refundExecution: execution,
        requiresReceiveAccount,
      };
    }

    // 2) 연간 중도해지: 사용 개월을 월간 정가로 차감해 정산
    if (isAnnual) {
      const { refundAmount: policyAmount, breakdown } = this.calculateAnnualProration({
        paidAmount: input.plan.price,
        monthlyListPrice: input.monthlyListPrice,
        // 청약철회 창은 법정 기준(결제일로부터)이라 보정하지 않지만, '이용한 기간' 정산에서는
        // 정지 기간을 빼야 한다 — 그 기간에는 멤버십 혜택을 쓸 수 없었다.
        daysElapsed: daysSincePeriodStart - input.pausedDaysInPeriod,
        benefitDiscount: input.termBenefitDiscount,
      });
      const refundAmount = this.capByRefundable(policyAmount, input.refundableAmount);

      if (refundAmount <= 0) {
        return {
          ...base,
          refundKind: 'ANNUAL_PRORATION',
          breakdown,
          unavailableReason:
            '사용 기간을 월간 정가로 정산하면 환불 가능 금액이 없습니다. 남은 기간까지 이용하실 수 있습니다.',
        };
      }

      return {
        ...base,
        available: true,
        refundAmount,
        refundKind: 'ANNUAL_PRORATION',
        refundExecution: execution,
        requiresReceiveAccount,
        breakdown,
      };
    }

    // 3) 월간: 청약철회 창을 지났으면 환불 불가 (안내문과 동일)
    return {
      ...base,
      unavailableReason: benefitUnused
        ? `결제 후 ${WITHDRAWAL_WINDOW_DAYS}일이 지나 환불이 불가합니다.`
        : '이번 결제 주기에 멤버십 혜택을 사용해 환불이 불가합니다.',
    };
  }
}
