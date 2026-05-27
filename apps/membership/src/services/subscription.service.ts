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
  ) {}

  /**
   * 현재 구독 상태 조회
   *
   * ✅ 흐름만 표현: "권한 조회"
   */
  async getCurrentSubscriptionDetails(userId: string) {
    const data = await this.entitlementService.getUserEntitlement(userId);
    if (!data) return null;
    return {
      ...data,
      billingDate: data.contract.billingDate ?? null,
      nextBillingDate: data.contract.nextBillingDate ?? null,
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
    );

    // 실패 시 로그만 남기고 구독 생성 자체는 성공으로 처리
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

    return result;
  }

  async createCheckoutIntent(
    userId: string,
    planId: string,
    returnUrl: string,
    email?: string,
    billingMode?: 'one_time' | 'recurring',
  ): Promise<{ intentId: string }> {
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
      this.paymentClientService
        .createBillingAgreement(userId, result.contractId)
        .catch((err: Error) =>
          this.logger.error(
            `billing_agreement 생성 실패 (userId=${userId}, contractId=${result.contractId}): ${err?.message}`,
            err?.stack,
          ),
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
  ) {
    const existing = await this.entitlementService.getUserEntitlement(userId);
    if (existing) throw new ActiveSubscriptionExistsException();

    const planDetails = await this.planService.getPlanDetails(planId);
    if (!planDetails) throw new PlanNotFoundException();
    if (!planDetails.plan.isActive) throw new PlanNotFoundException();

    let initialPaymentIntentId: string | undefined;
    if (billingMode === 'one_time') {
      const chargeResult = await this.paymentClientService.directCharge({
        userId,
        billingMethodId,
        amount: planDetails.plan.price,
        currency: planDetails.plan.currency ?? 'KRW',
        metadata: { planId: planDetails.plan.id, type: 'MEMBERSHIP_FEE', email },
        idempotencyKey: `membership:subscribe:${userId}:${planId}:${Date.now()}`,
      });
      if (chargeResult.status === 'FAILED') {
        throw new SubscriptionBadRequestException('결제에 실패했습니다. 카드 정보를 확인해주세요.');
      }
      initialPaymentIntentId = chargeResult.intentId;
    }

    const result = await this.subscriptionCreator.createNewSubscription(
      userId,
      planDetails.plan,
      planDetails.tier,
      { initialPaymentIntentId },
      billingMode,
    );

    Promise.all([
      ...(billingMode === 'recurring'
        ? [this.paymentClientService.createBillingAgreement(userId, result.contractId, billingMethodId)]
        : []),
      this.membershipEventPublisher.publishStatusChanged({
        userId,
        email,
        status: 'ACTIVE',
        occurredAt: new Date().toISOString(),
        contractId: result.contractId,
        planId: planDetails.plan.id,
        tierId: planDetails.tier.id,
      }),
    ]).catch((err: Error) =>
      this.logger.error(`post-subscribe fire-and-forget 실패 (userId=${userId}): ${err?.message}`, err?.stack),
    );

    return result;
  }

  /**
   * 관리자 직접 구독 등록 (무료체험 미적용, 즉시 결제 없음)
   */
  async adminCreateSubscription(userId: string, planId: string, billingMode: 'one_time' | 'recurring') {
    const [existing, planDetails] = await Promise.all([
      this.entitlementService.getUserEntitlement(userId),
      this.planService.getPlanDetails(planId),
    ]);
    if (existing) throw new ActiveSubscriptionExistsException();
    if (!planDetails) throw new PlanNotFoundException();
    if (!planDetails.plan.isActive) throw new PlanNotFoundException();

    const result = await this.subscriptionCreator.createNewSubscription(
      userId,
      planDetails.plan,
      planDetails.tier,
      {},
      billingMode,
      true,
    );

    this.membershipEventPublisher
      .publishStatusChanged({
        userId,
        email: '',
        status: 'ACTIVE',
        occurredAt: new Date().toISOString(),
        contractId: result.contractId,
        planId: planDetails.plan.id,
        tierId: planDetails.tier.id,
      })
      .catch((err: Error) =>
        this.logger.error(`MembershipStatusChanged Kafka 발행 실패 (userId=${userId}): ${err?.message}`, err?.stack),
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
