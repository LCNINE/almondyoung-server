import { Injectable, Logger } from '@nestjs/common';
import { differenceInDays } from 'date-fns';
import * as schema from '../../shared/schemas/entities/schema';
import { SubscriptionContractReader } from './subscription-contract.reader';
import { BenefitReader } from '../benefit/benefit.reader';
import { PauseReader } from '../pause/pause.reader';
import { PaymentClientService } from '../billing/payment-client.service';
import {
  ANNUAL_PLAN_MIN_DURATION_DAYS,
  CancellationPolicyDecision,
  RefundPolicyService,
} from './refund-policy.service';

type Contract = typeof schema.subscriptionContracts.$inferSelect;
type Plan = typeof schema.plan.$inferSelect;

export interface CancellationContext {
  contract: Contract;
  plan: Plan;
  entitlement: { id: string; endsAt: string; startsAt: string; pausedAt: Date | null };
  /** 정지 중이라 아직 종료일에 반영되지 않은 일수. 해지 시 재개하며 이만큼 연장된다. */
  pausedDaysAccrued: number;
  decision: CancellationPolicyDecision;
  /**
   * 이번 결제 주기에 실제로 받은 멤버십 할인. 환불 가능 여부를 가른 근거 그 자체다.
   *
   * 고객·CS 가 "왜 환불이 막혔는지" 를 숫자로 확인할 수 있어야 문의에 답할 수 있다.
   */
  currentPeriodBenefit: { orderCount: number; totalDiscountAmount: number };
  /** 혜택 사용량을 센 구간의 시작(=이번 결제 주기 시작). 결제 기록이 없으면 null. */
  benefitPeriodStart: string | null;
  /** 정기결제 계약인지 — 1회 결제는 '해지'가 아니라 '만료 시 종료'다 */
  isRecurring: boolean;
  /** 이미 해지 예약된 상태인지 */
  alreadyScheduledForCancellation: boolean;
}

/**
 * 해지 판단에 필요한 사실들을 한 번에 모으는 Reader.
 *
 * 미리보기(고객 화면·관리자 견적)와 실제 해지 실행이 **같은 입력**으로 같은 결론을 내도록
 * 수집 지점을 하나로 묶는다. 미리보기와 실행이 다른 계산을 하면 "34,930원 환불" 을 보고 눌렀는데
 * 다른 금액이 나가는 사고가 된다.
 */
@Injectable()
export class CancellationContextReader {
  private readonly logger = new Logger(CancellationContextReader.name);

  constructor(
    private readonly contractReader: SubscriptionContractReader,
    private readonly benefitReader: BenefitReader,
    private readonly pauseReader: PauseReader,
    private readonly paymentClientService: PaymentClientService,
    private readonly refundPolicy: RefundPolicyService,
  ) {}

  /**
   * @param params.fresh 환불 상한을 캐시 없이 확정한다. 실제로 환불을 집행하는 경로만 켠다 —
   *   미리보기는 마이페이지 렌더링 경로라 짧은 캐시가 필요하지만, 집행 직전의 상한은 결제관리에서
   *   방금 나간 환불까지 반영해야 한다.
   */
  async load(params: {
    contract: Contract;
    plan: Plan;
    now?: Date;
    fresh?: boolean;
  }): Promise<CancellationContext | null> {
    const { contract, plan } = params;
    const now = params.now ?? new Date();

    const entitlement = await this.contractReader.findCurrentEntitlement(contract.userId);
    if (!entitlement) return null;

    const periodEndsAt = new Date(entitlement.endsAt);
    // 정지 중에는 endsAt 이 동결돼 있고 재개 시점에 실제 정지 일수만큼 연장된다.
    const pausedDaysAccrued = entitlement.pausedAt
      ? Math.max(0, differenceInDays(now, new Date(entitlement.pausedAt)))
      : 0;
    const hasPayment = !!contract.lastPaymentIntentId;
    // 인보이스 경로는 자격을 먼저 주고 효성 출금이 나중에 확정된다(lastPaymentIntentId 는 그때 붙는다).
    // 그 사이 해지하면 돌려줄 돈은 없지만 나갈 돈은 남아 있다 — 예정 출금을 지우는 쪽이 정석이다.
    const awaitingCollection = !hasPayment && contract.billingPath === 'INVOICE';
    // 주기 시작은 '마지막 결제 성공 시각'이 원천이다. endsAt 역산은 관리자 기간 조정·일시정지 재개로
    // endsAt 가 밀리면 함께 밀려 청약철회 7일 창을 되살린다. 결제 기록이 없는 옛 계약만 역산으로 폴백.
    const paidPeriodStart = hasPayment
      ? ((await this.contractReader.findLastChargeSuccessAt(contract.id)) ??
        this.refundPolicy.resolvePaidPeriodStart({
          periodEndsAt,
          durationDays: plan.durationDays,
          hasPayment,
          billingDate: contract.billingDate ? new Date(contract.billingDate) : null,
        }))
      : // 수금 전 선지급은 결제일이 없다. 청약철회 창은 재화 공급일(=자격 개시일)부터 센다.
        awaitingCollection
        ? new Date(entitlement.startsAt)
        : null;
    const pausedDaysInPeriod = paidPeriodStart
      ? await this.pauseReader.sumPausedDaysSince(contract.userId, paidPeriodStart)
      : 0;

    const isAnnual = plan.durationDays >= ANNUAL_PLAN_MIN_DURATION_DAYS;
    // 혜택 사용량은 **이번 결제 주기**(마지막 결제 성공 시각 이후)로 센다. 30일 고정 집계주기를 쓰면
    // 연간 계약에서 기간 경계가 어긋나고, 가입 전 주문이나 옛 계약의 할인이 섞여 들어온다.
    // 청약철회 창과 같은 기준점(paidPeriodStart)을 써야 화면 금액과 판정 근거가 어긋나지 않는다.
    const currentPeriodBenefit = paidPeriodStart
      ? await this.benefitReader.findBenefitUsageBetween(contract.userId, paidPeriodStart)
      : { orderCount: 0, totalDiscountAmount: 0 };
    // 연간 정산 차감액은 같은 집계에서 나온다 — 두 함수가 같은 할인을 다르게 세지 않게 한다.
    const termBenefitDiscount = isAnnual ? currentPeriodBenefit.totalDiscountAmount : 0;

    const monthlyListPrice = isAnnual
      ? await this.contractReader.findMonthlyListPrice(plan.tierId, plan.price)
      : plan.price;

    const refundability = hasPayment
      ? await this.loadRefundability(contract.lastPaymentIntentId!, params.fresh === true)
      : null;

    // 정기결제 판정: 자동갱신이 살아있거나, 해지 시점에 정기결제였던 계약.
    // recurringCancelledAt 만으로 판정하면 1회 결제 고객까지 '정기결제 해지 예약' 으로 보여
    // 해지 철회(=자동이체 약정 재생성)를 열어주게 된다 — 동의 없는 정기결제 전환이다.
    const isRecurring = contract.autoRenewal
      ? true
      : contract.recurringCancelledAt
        ? await this.contractReader.canResumeRecurring(contract)
        : false;

    const decision = this.refundPolicy.evaluate({
      now,
      isRecurring,
      plan: { price: plan.price, durationDays: plan.durationDays },
      monthlyListPrice,
      paidPeriodStart,
      pausedDaysInPeriod,
      periodEndsAt,
      pausedDaysAccrued,
      hasPayment,
      awaitingCollection,
      // wallet 조회가 실패하면 자동환불을 단정하지 않는다(수동 경로로 안전하게 떨어뜨린다).
      autoRefundSupported: refundability?.autoRefundSupported ?? false,
      requiresReceiveAccount: refundability?.requiresReceiveAccount ?? false,
      refundableAmount: refundability
        ? (refundability.remainingRefundableAmount ??
          Math.max(0, refundability.refundableAmount - refundability.alreadyRefundedAmount))
        : null,
      currentPeriodBenefit,
      termBenefitDiscount,
    });

    return {
      contract,
      plan,
      entitlement,
      pausedDaysAccrued,
      decision,
      currentPeriodBenefit,
      benefitPeriodStart: paidPeriodStart ? paidPeriodStart.toISOString() : null,
      isRecurring,
      alreadyScheduledForCancellation: !!contract.recurringCancelledAt,
    };
  }

  /** wallet 장애가 해지 자체를 막지 않도록 실패는 흡수하고 '자동환불 불가'로 본다. */
  private async loadRefundability(intentId: string, fresh: boolean) {
    try {
      return await this.paymentClientService.getRefundability(intentId, { fresh });
    } catch (err) {
      this.logger.warn(
        `환불 가능 여부 조회 실패 — 수동 환불 경로로 판단한다 (intentId=${intentId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
