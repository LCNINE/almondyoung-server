import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq } from 'drizzle-orm';
import { addDays } from 'date-fns';
import { ContractEventManager } from './contract-event.manager';
import { EntitlementManager } from '../entitlement/entitlement.manager';
import { MembershipPolicyService } from '../membership-policy.service';
import { PaymentIntentAlreadyUsedException } from '../../shared/exceptions/subscription.exceptions';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

// 정기결제는 월간 플랜(최대 31일)만 허용. 연간 플랜은 1회 결제 전용.
const RECURRING_MAX_DURATION_DAYS = 31;

type Plan = typeof schema.plan.$inferSelect;
type Tier = typeof schema.tiers.$inferSelect;
type CreateSubscriptionPaymentRefs = {
  initialPaymentIntentId?: string;
  initialPaymentAttemptId?: string;
  initialWalletReferenceId?: string;
  initialPaymentAmount?: number;
};

/**
 * SubscriptionCreator (Implementation Layer)
 *
 * 역할: 신규 구독 생성 (계약 + 권한)
 * - 계약 생성
 * - 권한 생성
 * - 이벤트 배치 생성
 */
@Injectable()
export class SubscriptionCreator {
  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly contractEventManager: ContractEventManager,
    private readonly entitlementManager: EntitlementManager,
    private readonly policyService: MembershipPolicyService,
  ) {}

  /**
   * 새 구독 생성 (계약 + 권한)
   */
  async createNewSubscription(
    userId: string,
    plan: Plan,
    tier: Tier,
    paymentRefs: CreateSubscriptionPaymentRefs = {},
    billingMode: 'one_time' | 'recurring' = 'one_time',
    skipTrial = false,
  ): Promise<{ contractId: string; entitlementId: string; effectiveTrialDays: number }> {
    if (billingMode === 'recurring' && plan.durationDays > RECURRING_MAX_DURATION_DAYS) {
      throw new BadRequestError(
        `정기결제는 월간 플랜(최대 ${RECURRING_MAX_DURATION_DAYS}일)만 지원합니다. (durationDays=${plan.durationDays})`,
      );
    }

    return await this.dbService.db.transaction(async (tx) => {
      const now = new Date();
      const startsAt = now;

      // 같은 결제로 기존 계약이 이미 생성됐으면 재사용(replay) 거부.
      // billing_events 의 uq_billing_events_intent_event 가 동시 요청 레이스를 막고,
      // 이 선조회는 intentId 가 이벤트에 기록되지 않은 레거시 계약까지 커버한다.
      if (paymentRefs.initialPaymentIntentId) {
        const [existing] = await tx
          .select({ id: schema.subscriptionContracts.id })
          .from(schema.subscriptionContracts)
          .where(eq(schema.subscriptionContracts.lastPaymentIntentId, paymentRefs.initialPaymentIntentId))
          .limit(1);
        if (existing) {
          throw new PaymentIntentAlreadyUsedException();
        }
      }

      // 무료체험은 정기결제 첫 구독자에게만 적용 (관리자 생성 시 skipTrial=true)
      let effectiveTrialDays = 0;
      if (billingMode === 'recurring' && !skipTrial) {
        const [isFirstTime, trialReuseEnabled] = await Promise.all([
          this.isFirstTimeSubscriber(userId),
          this.policyService.getBooleanPolicy('TRIAL_REUSE_PREVENTION', 'enabled', plan.tierId, true),
        ]);
        effectiveTrialDays = (isFirstTime || !trialReuseEnabled) ? (plan.trialDays || 0) : 0;
      }

      const autoRenewal = billingMode === 'recurring';
      const billingDate = addDays(startsAt, effectiveTrialDays);
      // nextBillingDate = billingDate: 체험 종료일이 곧 첫 결제일
      // 결제 성공 시 BillingOutcomeHandler가 nextBillingDate를 endsAt + durationDays로 갱신
      const nextBillingDate = billingMode === 'recurring' ? billingDate : null;
      // recurring: endsAt = 체험 종료일 (첫 결제 시 +durationDays 연장)
      // one_time: endsAt = 결제된 전체 서비스 기간
      const endsAt = billingMode === 'recurring'
        ? billingDate
        : addDays(startsAt, plan.durationDays);

      // 1. 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_CREATED',
          effectiveDate: now.toISOString().split('T')[0],
        })
        .returning();

      // 2. 구독 계약 생성
      const [contract] = await tx
        .insert(schema.subscriptionContracts)
        .values({
          userId,
          planId: plan.id,
          autoRenewal,
          billingDate: billingDate.toISOString().split('T')[0],
          nextBillingDate: nextBillingDate ? nextBillingDate.toISOString().split('T')[0] : null,
          lastPaymentIntentId: paymentRefs.initialPaymentIntentId ?? null,
          lastPaymentAttemptId: paymentRefs.initialPaymentAttemptId ?? null,
          walletReferenceId: paymentRefs.initialWalletReferenceId ?? null,
        })
        .returning();

      // 3. 계약 이벤트 기록
      await this.contractEventManager.addEvent(
        tx,
        contract.id,
        'CREATED',
        {
          planId: plan.id,
          billingDate: billingDate.toISOString().split('T')[0],
          billingMode,
          effectiveTrialDays,
        },
        'USER',
        userId,
        batch.id,
        userId,
      );

      // 4. 최초 결제 기록. paymentIntentId 를 함께 남겨 uq_billing_events_intent_event 가
      //    같은 결제로 새 계약을 재발급하는 replay 를 DB 레벨에서 차단하게 한다.
      if (paymentRefs.initialPaymentIntentId && paymentRefs.initialPaymentAmount != null) {
        try {
          await tx.insert(schema.billingEvents).values({
            contractId: contract.id,
            eventType: 'CHARGE_SUCCESS',
            attemptNo: 1,
            amount: paymentRefs.initialPaymentAmount,
            paymentIntentId: paymentRefs.initialPaymentIntentId,
          });
        } catch (err: unknown) {
          if (isUniqueViolation(err)) {
            throw new PaymentIntentAlreadyUsedException();
          }
          throw err;
        }
      }

      // 5. 구독 권한 생성
      const entitlement = await this.entitlementManager.createEntitlement(
        tx,
        userId,
        tier.id,
        startsAt,
        endsAt,
        batch.id,
      );

      return {
        contractId: contract.id,
        entitlementId: entitlement.id,
        effectiveTrialDays,
      };
    });
  }

  /**
   * 첫 구독 여부 확인 (무료 체험 악용 방지)
   *
   * 과거 구독 이력이 없으면 첫 구독으로 판단
   */
  private async isFirstTimeSubscriber(userId: string): Promise<boolean> {
    const contracts = await this.dbService.db
      .select()
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.userId, userId))
      .limit(1);

    return contracts.length === 0;
  }
}
