import { Injectable, HttpStatus } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq } from 'drizzle-orm';
import { addDays } from 'date-fns';
import { ContractEventManager } from './contract-event.manager';
import { EntitlementManager } from '../entitlement/entitlement.manager';
import { SubscriptionException } from '../../shared/exceptions/subscription.exceptions';

type Contract = typeof schema.subscriptionContracts.$inferSelect;
type Plan = typeof schema.plan.$inferSelect;
type Tier = typeof schema.tiers.$inferSelect;

/**
 * SubscriptionManager (Implementation Layer)
 *
 * 역할: 구독 변경 로직 + 검증 + DB 접근
 * - 구독 업그레이드
 * - 구독 다운그레이드
 * - 구독 무효화
 */
@Injectable()
export class SubscriptionManager {
  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly contractEventManager: ContractEventManager,
    private readonly entitlementManager: EntitlementManager,
  ) {}

  /**
   * 구독 업그레이드 처리
   */
  async upgradeSubscription(
    userId: string,
    currentContract: Contract,
    currentTierId: string,
    newPlan: Plan,
    newTier: Tier,
    currentTierPriority: number,
  ): Promise<{ newEntitlementId: string; effectiveDate: Date }> {
    // 검증: 티어 우선순위 확인
    if (newTier.priorityLevel <= currentTierPriority) {
      throw new SubscriptionException(
        '새 플랜이 현재 플랜보다 등급이 높지 않습니다.',
        'INVALID_PLAN_CHANGE',
        HttpStatus.BAD_REQUEST,
      );
    }

    return await this.dbService.db.transaction(async (tx) => {
      const now = new Date();
      const newEndsAt = addDays(now, newPlan.durationDays);

      // 1. 업그레이드 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_UPGRADED',
          effectiveDate: now.toISOString().split('T')[0],
        })
        .returning();

      // 2. 기존 계약의 플랜을 새 플랜으로 업데이트
      await tx
        .update(schema.subscriptionContracts)
        .set({ planId: newPlan.id })
        .where(eq(schema.subscriptionContracts.id, currentContract.id));

      // 3. PLAN_CHANGED 이벤트 추가
      await this.contractEventManager.addEvent(
        tx,
        currentContract.id,
        'PLAN_CHANGED',
        {
          fromPlanId: currentContract.planId,
          toPlanId: newPlan.id,
          fromTierId: currentTierId,
          toTierId: newTier.id,
        },
        'USER',
        userId,
        batch.id,
        userId,
      );

      // 4. 새 권한 생성 (기존 권한은 자동 종료됨)
      const newEntitlement = await this.entitlementManager.createEntitlement(
        tx,
        userId,
        newTier.id,
        now,
        newEndsAt,
        batch.id,
      );

      return {
        newEntitlementId: newEntitlement.id,
        effectiveDate: now,
      };
    });
  }

  /**
   * 구독 다운그레이드 처리
   */
  async downgradeSubscription(
    userId: string,
    currentContract: Contract,
    newPlan: Plan,
    newTier: Tier,
    currentTierPriority: number,
  ): Promise<{ newEntitlementId: string; effectiveDate: Date }> {
    // 검증: 티어 우선순위 확인
    if (newTier.priorityLevel >= currentTierPriority) {
      throw new SubscriptionException(
        '새 플랜이 현재 플랜보다 등급이 낮지 않습니다.',
        'INVALID_PLAN_CHANGE',
        HttpStatus.BAD_REQUEST,
      );
    }

    return await this.dbService.db.transaction(async (tx) => {
      const now = new Date();
      const newEndsAt = addDays(now, newPlan.durationDays);

      // 1. 다운그레이드 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_DOWNGRADED',
          effectiveDate: now.toISOString().split('T')[0],
        })
        .returning();

      // 2. 기존 계약의 플랜을 새 플랜으로 업데이트
      await tx
        .update(schema.subscriptionContracts)
        .set({ planId: newPlan.id })
        .where(eq(schema.subscriptionContracts.id, currentContract.id));

      // 3. PLAN_CHANGED 이벤트 추가
      await this.contractEventManager.addEvent(
        tx,
        currentContract.id,
        'PLAN_CHANGED',
        {
          fromPlanId: currentContract.planId,
          toPlanId: newPlan.id,
          changeType: 'DOWNGRADE',
        },
        'USER',
        userId,
        batch.id,
        userId,
      );

      // 4. 새 권한 생성
      const newEntitlement = await this.entitlementManager.createEntitlement(
        tx,
        userId,
        newTier.id,
        now,
        newEndsAt,
        batch.id,
      );

      return {
        newEntitlementId: newEntitlement.id,
        effectiveDate: now,
      };
    });
  }

  /**
   * 구독 무효화 (취소)
   */
  async voidSubscription(
    userId: string,
    contract: Contract,
    reason?: string,
  ): Promise<{ cancelledAt: Date; contractId: string }> {
    return await this.dbService.db.transaction(async (tx) => {
      const now = new Date();

      // 1. 취소 이벤트 배치 생성
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({
          type: 'SUBSCRIPTION_CANCELLED',
          effectiveDate: now.toISOString().split('T')[0],
        })
        .returning();

      // 2. 계약 무효화
      await tx
        .update(schema.subscriptionContracts)
        .set({
          isVoided: true,
          voidedAt: now,
          reason,
          status: 'CANCELLED',
          cancelledAt: now,
          autoRenewal: false,
          nextBillingDate: null,
        })
        .where(eq(schema.subscriptionContracts.id, contract.id));

      // 3. 권한 종료
      await this.entitlementManager.terminateActiveEntitlement(tx, userId, batch.id);

      return {
        cancelledAt: now,
        contractId: contract.id,
      };
    });
  }
}
