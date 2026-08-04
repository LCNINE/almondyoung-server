import { Injectable, Logger } from '@nestjs/common';
import {
  SubscriptionNotFoundException,
  ActiveSubscriptionExistsException,
  PlanNotFoundException,
  BadRequestException as SubscriptionBadRequestException,
} from '../shared/exceptions/subscription.exceptions';
import { EntitlementService } from './entitlement.service';
import { PlanService } from './plan.service';
import { SubscriptionContractReader } from './subscription/subscription-contract.reader';
import { SubscriptionCreator } from './subscription/subscription.creator';
import { SubscriptionManager } from './subscription/subscription.manager';
import { MembershipEventPublisher } from './membership-event.publisher';
import { PaymentClientService, WalletPaymentIntentResponse } from './billing/payment-client.service';
import { BillingManager } from './billing/billing.manager';
import { BillingReader } from './billing/billing.reader';
import { InvoiceBillingManager } from './billing/invoice-billing.manager';
import { ConfigService } from '@nestjs/config';
import { format } from 'date-fns';

/**
 * SubscriptionService (Business Layer)
 *
 * 역할: 비즈니스 흐름만 표현 (2-3줄)
 * - 검증 로직 없음 (Manager가 담당)
 * - 상세 구현 없음 (Creator/Manager가 담당)
 * - Reader/Creator/Manager를 중계
 */

type CreateSubscriptionOptions = {
  initialPaymentIntentId?: string;
  initialPaymentAttemptId?: string;
  initialWalletReferenceId?: string;
  initialPaymentAmount?: number;
};

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly entitlementService: EntitlementService,
    private readonly planService: PlanService,
    private readonly contractReader: SubscriptionContractReader,
    private readonly subscriptionCreator: SubscriptionCreator,
    private readonly subscriptionManager: SubscriptionManager,
    private readonly membershipEventPublisher: MembershipEventPublisher,
    private readonly paymentClientService: PaymentClientService,
    private readonly billingManager: BillingManager,
    private readonly billingReader: BillingReader,
    private readonly invoiceBillingManager: InvoiceBillingManager,
    private readonly configService: ConfigService,
  ) {}

  /** ADR-0027 Phase 2 dual-path flag — 신규 정기 가입에만 적용, 기존 계약 경로는 불변. */
  private isInvoiceBillingEnabled(): boolean {
    return this.configService.get<string>('MEMBERSHIP_INVOICE_BILLING_ENABLED') === 'true';
  }

  /**
   * 현재 구독 상태 조회
   *
   * 스토어프론트가 기대하는 평탄한 형태로 반환한다(중첩 {entitlement,contract,...} 를 그대로 내려주면
   * 톱레벨 status/autoRenewal 등이 undefined 라 가입자 화면 전체가 차단된다).
   * status 는 raw(ACTIVE/CANCELLED/EXPIRED)로 두고 — 정기해지(RECURRING_CANCELLED)는 잔여기간 동안
   * status=ACTIVE 를 유지해야 회원 화면에 도달한다 — autoRenewal/pausedAt 를 별도로 노출해 프론트가
   * "해지 예정"·"일시정지" 라벨을 표시한다.
   */
  async getCurrentSubscriptionDetails(userId: string) {
    const data = await this.entitlementService.getUserEntitlement(userId);
    if (!data) return null;

    const { entitlement, contract, plan, tier } = data;
    // 고객에겐 "결제 확인 필요" boolean 만 노출. 연체 신호는 레거시=dunning 큐,
    // 인보이스 경로=isPastDue(인보이스 경로에서만 신뢰 — 레거시 잔재값 방지).
    const paymentActionNeeded =
      (contract.billingPath === 'INVOICE' && contract.isPastDue) ||
      (await this.billingReader.findDunningByContractId(contract.id)) !== null;
    const tierDto = tier
      ? {
          id: tier.id,
          code: tier.code,
          // tiers 테이블에 name 컬럼이 없다 — 프론트가 code/기본값으로 폴백하므로 null 로 내려준다.
          name: null as string | null,
          priorityLevel: tier.priorityLevel,
          createdAt: tier.createdAt,
          updatedAt: tier.updatedAt,
        }
      : null;

    return {
      id: contract.id,
      userId: contract.userId,
      planId: contract.planId,
      status: contract.status,
      autoRenewal: contract.autoRenewal,
      pausedAt: entitlement.pausedAt ?? null,
      recurringCancelledAt: contract.recurringCancelledAt ?? null,
      paymentActionNeeded,
      startDate: entitlement.startsAt,
      endDate: entitlement.endsAt,
      currentPeriodStart: entitlement.startsAt,
      currentPeriodEnd: entitlement.endsAt,
      billingDate: contract.billingDate ?? null,
      nextBillingDate: contract.nextBillingDate ?? null,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
      plan: plan
        ? {
            id: plan.id,
            tierId: plan.tierId,
            price: plan.price,
            currency: plan.currency,
            durationDays: plan.durationDays,
            trialDays: plan.trialDays,
            isActive: plan.isActive,
            createdAt: plan.createdAt,
            updatedAt: plan.updatedAt,
            tier: tierDto,
          }
        : null,
      tier: tierDto,
    };
  }

  /**
   * 새 구독 생성
   *
   * ✅ 흐름만 표현: "기존 구독 확인 → 플랜 조회 → 구독 생성"
   */
  async createSubscription(
    userId: string,
    planId: string,
    email: string,
    options: CreateSubscriptionOptions = {},
    billingMode: 'one_time' | 'recurring' = 'one_time',
  ) {
    const existing = await this.entitlementService.getUserEntitlement(userId);
    if (existing) throw new ActiveSubscriptionExistsException();

    const planDetails = await this.planService.getPlanDetails(planId);
    if (!planDetails) throw new PlanNotFoundException();

    const result = await this.subscriptionCreator.createNewSubscription(
      userId,
      planDetails.plan,
      planDetails.tier,
      options,
      billingMode,
      false,
      'CHARGE',
      email,
    );

    // one_time 은 createNewSubscription 이 아웃박스에 원자적으로 기록하므로 여기서 발행하지 않는다.
    // recurring 만 기존 best-effort 발행 유지(가입 후 billing 설정까지 성공한 뒤 호출됨).
    if (billingMode !== 'one_time') {
      this.membershipEventPublisher
        .publishStatusChanged({
          userId,
          email,
          status: 'ACTIVE',
          occurredAt: new Date().toISOString(),
          contractId: result.contractId,
          planId: planDetails.plan.id,
          tierId: planDetails.tier.id,
        })
        .catch((err: Error) =>
          this.logger.error(`MembershipStatusChanged Kafka 발행 실패 (userId=${userId}): ${err?.message}`, err?.stack),
        );
    }

    return result;
  }

  async createCheckoutIntent(
    userId: string,
    planId: string,
    returnUrl: string,
    email?: string,
    billingMode?: 'one_time' | 'recurring',
  ): Promise<{ intentId: string }> {
    if (billingMode === 'recurring') {
      throw new SubscriptionBadRequestException(
        'checkout 결제 경로는 recurring 모드를 지원하지 않습니다. billingMode를 생략하거나 one_time을 사용하세요.',
      );
    }

    const existing = await this.entitlementService.getUserEntitlement(userId);
    if (existing) throw new ActiveSubscriptionExistsException();

    const planDetails = await this.planService.getPlanDetails(planId);
    if (!planDetails) throw new PlanNotFoundException();
    if (!planDetails.plan.isActive) throw new PlanNotFoundException();

    return this.paymentClientService.createMembershipCheckoutIntent({
      userId,
      planId: planDetails.plan.id,
      amount: planDetails.plan.price,
      returnUrl,
      currency: planDetails.plan.currency ?? 'KRW',
      email,
      billingMode,
    });
  }

  /**
   * checkout-intent 결제 완료 후 구독 생성
   * JWT 없이 wallet API key로 intent를 검증하고 구독을 생성합니다.
   */
  async confirmCheckoutIntent(intentId: string) {
    const intent = await this.paymentClientService.getWalletPaymentIntent(intentId);

    if (intent.status !== 'AUTHORIZED' && intent.status !== 'CAPTURED') {
      throw new SubscriptionBadRequestException(`결제가 완료되지 않았습니다. (status: ${intent.status})`);
    }

    const userId = intent.metadata?.userId;
    const planId = intent.metadata?.planId;
    const email = (intent.metadata?.email as string) ?? '';
    const rawBillingMode = intent.metadata?.billingMode;
    const billingMode = rawBillingMode === 'recurring' ? 'recurring' : 'one_time';

    if (!userId || !planId) {
      throw new SubscriptionBadRequestException('payment intent metadata에 userId 또는 planId가 없습니다.');
    }

    const result = await this.createSubscription(
      userId,
      planId,
      email,
      {
        initialPaymentIntentId: intentId,
        initialWalletReferenceId: this.extractWalletReference(intent),
        initialPaymentAmount: intent.payableAmount,
      },
      billingMode,
    );

    if (billingMode === 'recurring') {
      // checkout 경로는 billingMethodId가 없어 recurring 설정 불가.
      // createCheckoutIntent에서 이미 차단되므로 여기에 도달하면 이상 상태.
      this.logger.warn(
        `confirmCheckoutIntent: intentId=${intentId}에 recurring billingMode가 설정되어 있으나 billing agreement를 생성할 수 없습니다. ` +
          `(checkout 경로는 billingMethodId가 없음) — 구독은 생성되었으나 정기결제 설정 없이 처리됩니다.`,
      );
    }

    return result;
  }

  private extractWalletReference(intent: WalletPaymentIntentResponse): string | undefined {
    const raw = intent as unknown as Record<string, unknown>;
    const candidate = [
      intent?.metadata?.paymentKey,
      intent?.metadata?.providerTransactionId,
      intent?.metadata?.transactionId,
      raw.providerTransactionId,
      raw.paymentKey,
      raw.transactionId,
    ].find((value) => typeof value === 'string' && value.length > 0);

    return typeof candidate === 'string' ? candidate : undefined;
  }

  /**
   * 결제 환불에 따른 구독 회수 (confirmCheckoutIntent 의 역방향)
   *
   * wallet 이 발행하는 환불 성공 이벤트를 받아 해당 결제 intent 로 만들어진 구독을 무효화한다.
   * 멤버십이 시작한 취소(cancelSubscription → 환불 요청)는 이미 CANCELLED 라 멱등 스킵된다.
   */
  async voidByPaymentIntent(intentId: string, reason: string, refundedAmount?: number) {
    const contract = await this.contractReader.findByPaymentIntentId(intentId);
    if (!contract) return; // 멤버십 결제가 아니거나 구독 미생성 — 무시
    if (contract.status === 'CANCELLED') return; // 이미 회수됨 (취소→환불 경로 등) — 멱등

    // 부분 환불은 자격을 회수하지 않는다. 결제관리에서 배송 지연 사과 같은 소액 보상을 이 결제에
    // 걸면, 예전에는 그 이벤트만으로 멤버십 전체가 취소돼 돈은 조금 돌려주고 남은 이용권을 통째로
    // 뺏는 결과가 됐다. 회수는 '이 결제가 사실상 전부 환불됐을 때' 만 한다.
    if (!(await this.isFullyRefunded(intentId, contract.id, refundedAmount))) {
      this.logger.warn(
        `부분 환불 감지 — 구독은 유지한다 (intentId=${intentId}, contractId=${contract.id}, refunded=${refundedAmount ?? '-'})`,
      );
      return;
    }

    await this.subscriptionManager.voidSubscription(contract.userId, contract, reason);
  }

  /**
   * 이 결제가 전부 환불됐는지. wallet 이 권위(누적 환불액 대 환불 가능 총액)이고, 조회가 실패하면
   * 이벤트에 실린 이번 환불액을 플랜 정가와 비교해 판단한다.
   *
   * wallet 을 먼저 묻는 이유가 둘이다. (1) **누적** — 2,495원씩 두 번 나간 환불은 합계가 전액이지만
   * 이벤트 하나만 보면 영원히 부분으로 보인다. (2) **결제액 ≠ 플랜 정가일 수 있다** — 라이브 실측
   * (2026-07-31)에 멤버십 결제 중 포인트가 섞인 복합결제 4건이 있었고, 실제로 부분 환불된 건도
   * 있었다(4,990원 결제에 4,092원 환불). 정가 비교는 wallet 을 못 물었을 때의 거친 폴백일 뿐이다.
   *
   * 알 수 없으면 **회수하지 않는다** — 잘못 회수하면 고객이 산 이용권이 사라지고 되돌릴 창구도 없지만,
   * 회수가 늦어지는 건 관리자 강제취소로 언제든 끝낼 수 있다.
   */
  private async isFullyRefunded(intentId: string, contractId: string, refundedAmount?: number): Promise<boolean> {
    try {
      const r = await this.paymentClientService.getRefundability(intentId, { fresh: true });
      // 환불 가능 charge 가 남아있지 않으면(전부 REFUNDED 로 전이) 완전 환불이다.
      if (r.refundableAmount <= 0) return true;
      return r.alreadyRefundedAmount >= r.refundableAmount;
    } catch (err) {
      this.logger.warn(
        `환불 규모 조회 실패 — 이벤트 금액으로 판단한다 (intentId=${intentId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (refundedAmount == null) return false;
      const plan = await this.planService.getPlanDetails(
        (await this.contractReader.findById(contractId))?.planId ?? '',
      );
      return !!plan && refundedAmount >= plan.plan.price;
    }
  }

  /**
   * 구독 업그레이드
   *
   * ✅ 흐름만 표현: "현재 구독 조회 → 새 플랜 조회 → 업그레이드 실행"
   */
  async upgradeSubscription(userId: string, newPlanId: string) {
    const current = await this.entitlementService.getUserEntitlement(userId);
    if (!current) throw new SubscriptionNotFoundException();

    const newPlanDetails = await this.planService.getPlanDetails(newPlanId);
    if (!newPlanDetails) throw new PlanNotFoundException();

    return this.subscriptionManager.upgradeSubscription(
      userId,
      current.contract,
      current.tier.id,
      newPlanDetails.plan,
      newPlanDetails.tier,
      current.tier.priorityLevel,
    );
  }

  /**
   * 구독 다운그레이드
   *
   * ✅ 흐름만 표현: "현재 구독 조회 → 새 플랜 조회 → 다운그레이드 실행"
   */
  async downgradeSubscription(userId: string, newPlanId: string) {
    const current = await this.entitlementService.getUserEntitlement(userId);
    if (!current) throw new SubscriptionNotFoundException();

    const newPlanDetails = await this.planService.getPlanDetails(newPlanId);
    if (!newPlanDetails) throw new PlanNotFoundException();

    return this.subscriptionManager.downgradeSubscription(
      userId,
      current.contract,
      newPlanDetails.plan,
      newPlanDetails.tier,
      current.tier.priorityLevel,
    );
  }

  /**
   * 구독 취소
   *
   * ✅ 흐름만 표현: "현재 구독 조회 → 무효화"
   */
  async cancelSubscription(userId: string, reason?: string) {
    const current = await this.entitlementService.getUserEntitlement(userId);
    if (!current) throw new SubscriptionNotFoundException();

    await this.subscriptionManager.voidSubscription(userId, current.contract, reason);

    return {
      cancelledAt: new Date(),
      contractId: current.contract.id,
    };
  }

  /**
   * 구독 이력 조회
   *
   * ✅ 흐름만 표현: "계약 이력 조회 + 현재 entitlement endsAt + 조정 이벤트"
   */
  async getSubscriptionHistory(userId: string) {
    const [rows, currentEntitlementData, adjustmentEvents] = await Promise.all([
      this.contractReader.findContractsByUserIdWithPlan(userId),
      this.entitlementService.getUserEntitlement(userId),
      this.contractReader.findAdjustmentEventsByUserId(userId),
    ]);

    const currentEndsAt = currentEntitlementData?.entitlement.endsAt ?? null;

    const adjustmentsByContract = new Map<string, typeof adjustmentEvents>();
    for (const e of adjustmentEvents) {
      const list = adjustmentsByContract.get(e.contractId) ?? [];
      list.push(e);
      adjustmentsByContract.set(e.contractId, list);
    }

    return rows.map(({ contract, plan, tier }) => {
      const contractAdjustments = (adjustmentsByContract.get(contract.id) ?? []).map((e) => {
        const meta = e.metadata as { days?: number; previousEndsAt?: string; newEndsAt?: string; reason?: string };
        return {
          id: e.id,
          eventType: e.eventType,
          days: meta.days ?? 0,
          previousEndsAt: meta.previousEndsAt ?? null,
          newEndsAt: meta.newEndsAt ?? null,
          reason: meta.reason ?? null,
          createdAt: e.createdAt.toISOString(),
        };
      });

      return {
        id: contract.id,
        userId: contract.userId,
        planId: contract.planId,
        status: contract.status,
        billingDate: contract.billingDate,
        nextBillingDate: contract.nextBillingDate ?? null,
        cancelledAt: contract.cancelledAt?.toISOString() ?? null,
        autoRenewal: contract.autoRenewal,
        createdAt: contract.createdAt.toISOString(),
        updatedAt: contract.updatedAt.toISOString(),
        endDate: contract.status === 'ACTIVE' ? currentEndsAt : null,
        plan: { price: plan.price, currency: plan.currency ?? 'KRW', durationDays: plan.durationDays },
        tier: tier?.id ? { code: tier.code } : null,
        adjustments: contractAdjustments,
      };
    });
  }

  /**
   * 구독 이력 조회
   */
  async getSubscriptionHistoryPaged(userId: string, limit: number, offset: number) {
    const [rows, total, currentEntitlementData, adjustmentEvents] = await Promise.all([
      this.contractReader.findContractsByUserIdWithPlanPaged(userId, limit, offset),
      this.contractReader.countContractsByUserId(userId),
      this.entitlementService.getUserEntitlement(userId),
      this.contractReader.findAdjustmentEventsByUserId(userId),
    ]);

    const currentEndsAt = currentEntitlementData?.entitlement.endsAt ?? null;

    const adjustmentsByContract = new Map<string, typeof adjustmentEvents>();
    for (const e of adjustmentEvents) {
      const list = adjustmentsByContract.get(e.contractId) ?? [];
      list.push(e);
      adjustmentsByContract.set(e.contractId, list);
    }

    const items = rows.map(({ contract, plan, tier }) => {
      const contractAdjustments = (adjustmentsByContract.get(contract.id) ?? []).map((e) => {
        const meta = e.metadata as { days?: number; previousEndsAt?: string; newEndsAt?: string; reason?: string };
        return {
          id: e.id,
          eventType: e.eventType,
          days: meta.days ?? 0,
          previousEndsAt: meta.previousEndsAt ?? null,
          newEndsAt: meta.newEndsAt ?? null,
          reason: meta.reason ?? null,
          createdAt: e.createdAt.toISOString(),
        };
      });

      return {
        id: contract.id,
        userId: contract.userId,
        planId: contract.planId,
        status: contract.status,
        billingDate: contract.billingDate,
        nextBillingDate: contract.nextBillingDate ?? null,
        cancelledAt: contract.cancelledAt?.toISOString() ?? null,
        autoRenewal: contract.autoRenewal,
        createdAt: contract.createdAt.toISOString(),
        updatedAt: contract.updatedAt.toISOString(),
        endDate: contract.status === 'ACTIVE' ? currentEndsAt : null,
        plan: { price: plan.price, currency: plan.currency ?? 'KRW', durationDays: plan.durationDays },
        tier: tier?.id ? { code: tier.code } : null,
        adjustments: contractAdjustments,
      };
    });

    return { items, total };
  }

  /**
   * 활성 구독 정보 조회
   *
   * ✅ 흐름만 표현: "활성 계약 조회 → 구독 타입 판단"
   */
  async getActiveSubscription(userId: string) {
    const contract = await this.contractReader.findActiveContract(userId);
    if (!contract) return null;

    const plan = await this.contractReader.findPlan(contract.planId);
    if (!plan) return null;

    const subscriptionType: 'MONTHLY' | 'YEAR' = plan.durationDays === 30 ? 'MONTHLY' : 'YEAR';

    return {
      id: contract.id,
      userId: contract.userId,
      billingDate: new Date(contract.billingDate),
      type: subscriptionType,
      tierId: plan.tierId,
    };
  }
  /**
   * 기존 billing_method로 즉시 결제 후 구독 생성
   *
   * ✅ 흐름만 표현: "기존 구독 확인 → 플랜 조회 → 즉시 결제 → 구독 생성 → agreement 연결"
   */
  async subscribeWithBillingMethod(
    userId: string,
    planId: string,
    email: string,
    billingMethodId: string,
    billingMode: 'one_time' | 'recurring' = 'one_time',
    checkoutAttemptId?: string,
  ) {
    const existing = await this.entitlementService.getUserEntitlement(userId);
    if (existing) throw new ActiveSubscriptionExistsException();

    const planDetails = await this.planService.getPlanDetails(planId);
    if (!planDetails) throw new PlanNotFoundException();
    if (!planDetails.plan.isActive) throw new PlanNotFoundException();

    let initialPaymentIntentId: string | undefined;
    if (billingMode === 'one_time') {
      if (!checkoutAttemptId) {
        throw new SubscriptionBadRequestException('one_time 결제 시 checkoutAttemptId는 필수입니다');
      }
      const chargeResult = await this.paymentClientService.directCharge({
        userId,
        billingMethodId,
        amount: planDetails.plan.price,
        currency: planDetails.plan.currency ?? 'KRW',
        metadata: { planId: planDetails.plan.id, type: 'MEMBERSHIP_FEE', email },
        idempotencyKey: `membership:subscribe:${userId}:${planId}:${billingMethodId}:${checkoutAttemptId}`,
      });
      if (chargeResult.status === 'FAILED') {
        throw new SubscriptionBadRequestException('결제에 실패했습니다. 카드 정보를 확인해주세요.');
      }
      initialPaymentIntentId = chargeResult.intentId;
    }

    // ADR-0027 Phase 2 dual-path: 플래그가 켜진 동안의 신규 정기 가입만 인보이스(선적용) 경로.
    const invoicePath = billingMode === 'recurring' && this.isInvoiceBillingEnabled();

    const result = await this.subscriptionCreator.createNewSubscription(
      userId,
      planDetails.plan,
      planDetails.tier,
      {
        initialPaymentIntentId,
        // one_time 첫 결제 금액을 함께 넘겨야 creator가 billingEvents에 CHARGE_SUCCESS를 남긴다(결제내역 누락 방지).
        initialPaymentAmount: billingMode === 'one_time' ? planDetails.plan.price : undefined,
      },
      billingMode,
      false,
      invoicePath ? 'INVOICE' : 'CHARGE',
      email,
    );

    if (billingMode === 'recurring') {
      try {
        // 인보이스 경로는 CMS 심사 중(PENDING) 계좌도 허용(선적용) — 승인 대기는 wallet 인보이스가 흡수.
        await this.createBillingAgreementWithRetry(userId, result.contractId, billingMethodId, 2, invoicePath);
      } catch (err: unknown) {
        this.logger.error(
          `billing_agreement 생성 실패 — 구독 보상 처리 시작 (userId=${userId}, contractId=${result.contractId})`,
          err instanceof Error ? err.stack : String(err),
        );
        const contract = await this.contractReader.findById(result.contractId);
        if (contract) {
          await this.subscriptionManager.voidSubscription(userId, contract, '정기결제 설정 실패');
        }
        throw new SubscriptionBadRequestException('정기결제 설정에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }

      // 가입 즉시 첫 결제: 체험이 없으면(nextBillingDate=오늘) 가입 시점에 청구한다.
      // 체험(trial>0)이면 nextBillingDate가 미래라 일일 스케줄러가 그날 청구한다.
      // 발행 실패해도 가입은 유지 — 다음 스케줄러가 재시도하고, 만료 유예가 그 사이를 보호한다.
      const dueContract = await this.billingReader.findContractById(result.contractId);
      const today = format(new Date(), 'yyyy-MM-dd');
      if (dueContract?.nextBillingDate && dueContract.nextBillingDate <= today) {
        const billingResult = invoicePath
          ? await this.invoiceBillingManager.issueInvoiceForContract(dueContract, billingMethodId)
          : await this.billingManager.processSingleBilling(dueContract);
        if (!billingResult.success) {
          this.logger.error(
            `가입 즉시 첫 결제 발행 실패 (contractId=${result.contractId}): ${billingResult.errorMessage ?? billingResult.errorCode}`,
          );
        }
      }
    }

    // one_time 은 createNewSubscription 이 아웃박스에 원자적으로 기록하므로 여기서 발행하지 않는다.
    if (billingMode !== 'one_time') {
      this.membershipEventPublisher
        .publishStatusChanged({
          userId,
          email,
          status: 'ACTIVE',
          occurredAt: new Date().toISOString(),
          contractId: result.contractId,
          planId: planDetails.plan.id,
          tierId: planDetails.tier.id,
        })
        .catch((err: Error) =>
          this.logger.error(`MembershipStatusChanged Kafka 발행 실패 (userId=${userId}): ${err?.message}`, err?.stack),
        );
    }

    return result;
  }

  private async createBillingAgreementWithRetry(
    userId: string,
    contractId: string,
    billingMethodId?: string,
    maxAttempts = 2,
    allowPendingMandate = false,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.paymentClientService.createBillingAgreement(userId, contractId, billingMethodId, undefined, {
          allowPendingMandate,
        });
        return;
      } catch (err: unknown) {
        lastError = err;
        this.logger.warn(
          `billing_agreement 생성 시도 ${attempt}/${maxAttempts} 실패 (userId=${userId}, contractId=${contractId})`,
          err instanceof Error ? err.message : String(err),
        );
        if (attempt < maxAttempts) {
          await new Promise<void>((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    throw lastError;
  }

  /**
   * 관리자 직접 구독 등록 (무료체험 미적용, 즉시 결제 없음)
   */
  async adminCreateSubscription(userId: string, planId: string, billingMode: 'one_time' | 'recurring') {
    // 관리자 직접 등록은 결제수단·약정을 입력받지 않으므로 recurring 계약을 완결할 수 없다.
    // 그대로 두면 결제수단 없는 ACTIVE 계약이 만들어져 스케줄러에서 발산한다 — 명시적으로 거부한다.
    // 정기결제는 고객이 결제수단을 등록해야 하고, 관리자 무상 부여는 grant(구독 지급)를 사용한다.
    if (billingMode === 'recurring') {
      throw new SubscriptionBadRequestException(
        '관리자 직접 등록은 정기결제(recurring)를 지원하지 않습니다. one_time 으로 등록하거나 구독 지급(grant)을 사용하세요.',
      );
    }
    const [existing, planDetails] = await Promise.all([
      this.entitlementService.getUserEntitlement(userId),
      this.planService.getPlanDetails(planId),
    ]);
    if (existing) throw new ActiveSubscriptionExistsException();
    if (!planDetails) throw new PlanNotFoundException();
    if (!planDetails.plan.isActive) throw new PlanNotFoundException();

    // 관리자 등록은 항상 one_time — createNewSubscription 이 아웃박스에 원자적으로 발행한다.
    const result = await this.subscriptionCreator.createNewSubscription(
      userId,
      planDetails.plan,
      planDetails.tier,
      {},
      billingMode,
      true,
      'CHARGE',
      '',
    );

    return result;
  }

  /**
   * 여러 사용자의 구독 정보 일괄 조회
   *
   * ✅ 흐름만 표현: "여러 사용자 권한 조회 → 응답 포맷팅"
   */

  async getBulkSubscriptions(userIds: string[]) {
    const entitlementMap = await this.entitlementService.getBulkUserEntitlements(userIds);

    return userIds.map((userId) => {
      const data = entitlementMap.get(userId);

      if (!data) {
        return {
          id: userId,
          membership: null,
        };
      }

      return {
        id: userId,
        membership: {
          tierId: data.tier.id,
          tierCode: data.tier.code,
          tierPriority: data.tier.priorityLevel,
          planId: data.plan.id,
          planPrice: data.plan.price,
          planDuration: data.plan.durationDays,
          startsAt: data.entitlement.startsAt,
          endsAt: data.entitlement.endsAt,
          contractId: data.contract.id,
          billingDate: data.contract.billingDate,
          nextBillingDate: data.contract.nextBillingDate,
          isPaused: !!data.entitlement.pausedAt,
        },
      };
    });
  }
}
