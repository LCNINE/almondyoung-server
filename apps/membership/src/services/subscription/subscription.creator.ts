import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq } from 'drizzle-orm';
import { addDays } from 'date-fns';
import { ContractEventManager } from './contract-event.manager';
import { EntitlementManager } from '../entitlement/entitlement.manager';

type Plan = typeof schema.plan.$inferSelect;
type Tier = typeof schema.tiers.$inferSelect;

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
  ) {}

  /**
   * 새 구독 생성 (계약 + 권한)
   */
  async createNewSubscription(
    userId: string,
    plan: Plan,
    tier: Tier,
  ): Promise<{ contractId: string; entitlementId: string }> {
    return await this.dbService.db.transaction(async (tx) => {
      const now = new Date();
      const startsAt = now;

      // 1. 첫 구독 여부 확인 (무료 체험 악용 방지)
      const isFirstTime = await this.isFirstTimeSubscriber(userId);
      const effectiveTrialDays = isFirstTime ? plan.trialDays || 0 : 0;

      // 2. 날짜 계산
      // - endsAt: 구독 종료일 (무료 체험 포함, 30일 플랜이면 30일)
      // - billingDate: 첫 결제일 (무료 체험 후)
      // - nextBillingDate: 다음 결제일 (첫 결제 + 30일)
      const endsAt = addDays(startsAt, plan.durationDays);
      const billingDate = addDays(startsAt, effectiveTrialDays);
      const nextBillingDate = addDays(billingDate, plan.durationDays);

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
          billingDate: billingDate.toISOString().split('T')[0],
          nextBillingDate: nextBillingDate.toISOString().split('T')[0],
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
          trialDays: plan.trialDays || 0,
          effectiveTrialDays, // 실제 적용된 무료 체험 기간
          isFirstTimeSubscriber: isFirstTime, // 첫 구독 여부
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
