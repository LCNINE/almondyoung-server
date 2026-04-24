import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq } from 'drizzle-orm';
import { addDays } from 'date-fns';
import { ContractEventManager } from './contract-event.manager';
import { EntitlementManager } from '../entitlement/entitlement.manager';
import { MembershipPolicyService } from '../membership-policy.service';

type Plan = typeof schema.plan.$inferSelect;
type Tier = typeof schema.tiers.$inferSelect;
type CreateSubscriptionPaymentRefs = {
  initialPaymentIntentId?: string;
  initialPaymentAttemptId?: string;
  initialWalletReferenceId?: string;
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
  ): Promise<{ contractId: string; entitlementId: string }> {
    return await this.dbService.db.transaction(async (tx) => {
      const now = new Date();
      const startsAt = now;

      // 무료체험은 정기결제 첫 구독자에게만 적용
      let effectiveTrialDays = 0;
      if (billingMode === 'recurring') {
        const [isFirstTime, trialDays, trialReuseEnabled] = await Promise.all([
          this.isFirstTimeSubscriber(userId),
          this.policyService.getNumberPolicy('TRIAL_DURATION_DAYS', 'days', plan.tierId, plan.trialDays || 0),
          this.policyService.getBooleanPolicy('TRIAL_REUSE_PREVENTION', 'enabled', plan.tierId, true),
        ]);
        effectiveTrialDays = isFirstTime || !trialReuseEnabled ? trialDays : 0;
      }

      const autoRenewal = billingMode === 'recurring';
      const billingDate = addDays(startsAt, effectiveTrialDays);
      const nextBillingDate = billingMode === 'recurring' ? addDays(billingDate, plan.durationDays) : null;
      // 체험 기간을 포함한 만료일 (체험 기간만큼 연장)
      const endsAt = addDays(startsAt, plan.durationDays + effectiveTrialDays);

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

      // 3. CREATED 이벤트 추가
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

      // 4. 구독 권한 생성
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
