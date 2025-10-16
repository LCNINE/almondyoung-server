import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { addDays } from 'date-fns';
import { ContractEventService } from '../contract-event.service';
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
    private readonly contractEventService: ContractEventService,
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
      const endsAt = addDays(
        startsAt,
        plan.durationDays + (plan.trialDays || 0),
      );
      const billingDate = addDays(startsAt, plan.trialDays || 0);
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
      await this.contractEventService.addEvent(
        tx,
        contract.id,
        'CREATED',
        {
          planId: plan.id,
          billingDate: billingDate.toISOString().split('T')[0],
          trialDays: plan.trialDays || 0,
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
}
