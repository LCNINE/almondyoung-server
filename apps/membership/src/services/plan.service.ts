import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, desc } from 'drizzle-orm';
import * as schema from '../shared/schemas/entities/schema'; // 새로운 스키마 import
import type {
  CreateTierInput,
  UpdateTierInput,
  CreatePlanInput,
  UpdatePlanInput,
  Plan,
  Tier,
} from '../shared/schemas'; // index.ts를 통해 import

@Injectable()
export class PlanService {
  constructor(private readonly dbService: DbService<typeof schema>) {}

  /**
   * Retrieves all active subscription plans with their tier information.
   */
  async getAllPlans() {
    return await this.dbService.db
      .select({
        plan: schema.plan,
        tier: schema.tiers,
      })
      .from(schema.plan)
      .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .where(eq(schema.plan.isActive, true))
      .orderBy(schema.tiers.priorityLevel);
  }

  /**
   * Retrieves detailed information for a specific subscription plan.
   */
  async getPlanDetails(planId: string) {
    const result = await this.dbService.db
      .select({
        plan: schema.plan,
        tier: schema.tiers,
      })
      .from(schema.plan)
      .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .where(and(eq(schema.plan.id, planId), eq(schema.plan.isActive, true)))
      .limit(1);

    if (!result.length) {
      throw new Error('Plan not found');
    }

    return result[0];
  }

  /**
   * Retrieves all subscription tiers ordered by priority level.
   */
  async getAllTiers(): Promise<Tier[]> {
    return await this.dbService.db
      .select()
      .from(schema.tiers)
      .orderBy(schema.tiers.priorityLevel);
  }

  /**
   * Retrieves all active plans for a specific subscription tier.
   */
  async getPlansByTier(tierId: string): Promise<Plan[]> {
    return this.dbService.db
      .select()
      .from(schema.plan)
      .where(
        and(eq(schema.plan.tierId, tierId), eq(schema.plan.isActive, true)),
      )
      .orderBy(desc(schema.plan.createdAt));
  }

  /**
   * Retrieves tier with its associated plans.
   */
  async getTierWithPlans(tierId: string) {
    const tier = await this.dbService.db
      .select()
      .from(schema.tiers)
      .where(eq(schema.tiers.id, tierId))
      .limit(1);

    if (!tier.length) {
      throw new Error('Tier not found');
    }

    const plans = await this.getPlansByTier(tierId);

    return {
      tier: tier[0],
      plans,
    };
  }

  // ===== 관리자용 메서드들 =====

  /**
   * 티어 생성 (관리자용)
   */
  async createTier(createTierInput: CreateTierInput, adminId: string) {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 동일한 코드를 가진 티어가 이미 존재하는지 확인합니다.
      const [existingCode] = await tx
        .select({ id: schema.tiers.id })
        .from(schema.tiers)
        .where(eq(schema.tiers.code, createTierInput.code))
        .limit(1);

      if (existingCode) {
        throw new Error(`Tier code already exists: ${createTierInput.code}`);
      }

      // 2. 동일한 랭크를 가진 티어가 이미 존재하는지 확인합니다.
      const [existingRank] = await tx
        .select({ id: schema.tiers.id })
        .from(schema.tiers)
        .where(eq(schema.tiers.priorityLevel, createTierInput.priorityLevel))
        .limit(1);

      if (existingRank) {
        throw new Error(
          `Priority level already exists: ${createTierInput.priorityLevel}`,
        );
      }

      // 3. 새로운 티어를 생성하고 생성된 티어의 ID를 반환받습니다.
      const [newTier] = await tx
        .insert(schema.tiers)
        .values(createTierInput)
        .returning({ id: schema.tiers.id });

      // 4. 'event_batches' 테이블에 티어 생성 이벤트를 기록합니다.
      await tx.insert(schema.eventBatches).values({
        id: crypto.randomUUID(),
        type: 'TIER_CREATED',
        adminId: adminId,
        effectiveDate: new Date().toISOString().split('T')[0],
      });

      return { tierId: newTier.id };
    });
  }

  /**
   * 티어 수정 (관리자용)
   */ async updateTier(
    tierId: string,
    updateTierInput: UpdateTierInput,
    adminId: string,
  ) {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 수정할 티어가 존재하는지 확인합니다.
      const [existingTier] = await tx
        .select()
        .from(schema.tiers)
        .where(eq(schema.tiers.id, tierId))
        .limit(1);

      if (!existingTier) {
        throw new Error('Tier not found');
      }

      // 2. 랭크를 변경하는 경우, 해당 랭크가 이미 사용 중인지 확인합니다.
      if (
        updateTierInput.priorityLevel &&
        updateTierInput.priorityLevel !== existingTier.priorityLevel
      ) {
        const [existingRank] = await tx
          .select({ id: schema.tiers.id })
          .from(schema.tiers)
          .where(eq(schema.tiers.priorityLevel, updateTierInput.priorityLevel))
          .limit(1);

        if (existingRank) {
          throw new Error(
            `Priority level already exists: ${updateTierInput.priorityLevel}`,
          );
        }
      }

      // 3. 티어 정보를 업데이트합니다.
      await tx
        .update(schema.tiers)
        .set({
          ...updateTierInput,
          updatedAt: new Date(),
        })
        .where(eq(schema.tiers.id, tierId));

      // 4. 'event_batches' 테이블에 티어 업데이트 이벤트를 기록합니다.
      await tx.insert(schema.eventBatches).values({
        id: crypto.randomUUID(),
        type: 'TIER_UPDATED',
        adminId: adminId,
        effectiveDate: new Date().toISOString().split('T')[0],
      });

      return { tierId };
    });
  }

  /**
   * 플랜 생성 (관리자용)
   */
  async createPlan(createPlanInput: CreatePlanInput, adminId: string) {
    return await this.dbService.db.transaction(async (tx) => {
      const [tier] = await tx
        .select({ id: schema.tiers.id })
        .from(schema.tiers)
        .where(eq(schema.tiers.id, createPlanInput.tierId))
        .limit(1);
      if (!tier) throw new Error('Tier not found');

      // createPlanInput에 trialDays가 포함되어 있으므로 그대로 사용
      const [newPlan] = await tx
        .insert(schema.plan)
        .values({ ...createPlanInput, isActive: true })
        .returning();

      await tx.insert(schema.eventBatches).values({
        id: crypto.randomUUID(),
        type: 'PLAN_CREATED',
        adminId: adminId,
        effectiveDate: new Date().toISOString().split('T')[0],
      });

      return { planId: newPlan.id };
    });
  }

  /**
   * 플랜 수정 (관리자용)
   */
  async updatePlan(
    planId: string,
    updatePlanInput: UpdatePlanInput,
    adminId: string,
  ) {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 수정할 플랜이 존재하는지 확인합니다.
      const [existingPlan] = await tx
        .select()
        .from(schema.plan)
        .where(eq(schema.plan.id, planId))
        .limit(1);

      if (!existingPlan) {
        throw new Error('Plan not found');
      }

      // 2. 플랜 데이터를 업데이트합니다.
      await tx
        .update(schema.plan)
        .set({
          ...updatePlanInput,
          updatedAt: new Date(),
        })
        .where(eq(schema.plan.id, planId));

      // 3. 'event_batches' 테이블에 플랜 업데이트 이벤트를 기록합니다.
      await tx.insert(schema.eventBatches).values({
        id: crypto.randomUUID(),
        type: 'PLAN_UPDATED',
        adminId: adminId,
        effectiveDate: new Date().toISOString().split('T')[0],
      });

      // [추가 구현 필요]
      // '활성 구독자'를 조회하는 로직 정의 후, 아래 주석을 해제하고
      // notifySubscribersOfPlanChange 메소드를 구현해야 합니다.
      /*
      const [tier] = await tx.select().from(schema.tiers).where(eq(schema.tiers.id, existingPlan.tierId));
      await this.notifySubscribersOfPlanChange(
        tx,
        planId,
        existingPlan,
        updatePlanInput,
        tier,
      );
      */

      return { planId };
    });
  }

  /**
   * 플랜 비활성화 (관리자용)
   */

  async deactivatePlan(planId: string, reason: string, adminId: string) {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 비활성화할 플랜이 존재하는지 확인합니다.
      const [existingPlan] = await tx
        .select({ id: schema.plan.id })
        .from(schema.plan)
        .where(eq(schema.plan.id, planId))
        .limit(1);

      if (!existingPlan) {
        throw new Error('Plan not found');
      }

      // 2. 플랜을 비활성화(soft delete) 처리합니다.
      await tx
        .update(schema.plan)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.plan.id, planId));

      // 3. 'event_batches' 테이블에 플랜 비활성화 이벤트를 기록합니다.
      await tx.insert(schema.eventBatches).values({
        id: crypto.randomUUID(),
        type: 'PLAN_DEACTIVATED',
        adminId: adminId,
        effectiveDate: new Date().toISOString().split('T')[0],
      });

      return { planId };
    });
  }

  /**
   * 플랜 변경 시 기존 구독자들에게 알림
   */
  // private async notifySubscribersOfPlanChange(
  //   tx: any,
  //   planId: string,
  //   oldPlan: Plan,
  //   newPlan: UpdatePlanInput,
  //   tier: Tier,
  // ) {
  //   // [확인 필요] 아래 로직은 '활성 구독자' 조회 방식에 대한 정의가 필요합니다.
  //   // 현재는 동작하지 않는 상태로 남겨둡니다.
  //   console.log('Skipping subscriber notification due to schema change.');
  //   return;

  //   /*
  //   const activeSubscribers = await tx.select(...)
  //     .from(schema.subscriptionEntitlement)
  //     .innerJoin(...)
  //     .where(...); // '활성 구독자' 조회 로직

  //   for (const subscriber of activeSubscribers) {
  //     // ... 이벤트 기록 로직
  //   }
  //   */
  // }

  /**
   * 알림 타입 결정
   */
  private determineNotificationType(
    oldPlan: Plan,
    newPlan: UpdatePlanInput,
  ): string {
    if (newPlan.price !== undefined && newPlan.price > oldPlan.price) {
      return 'PLAN_PRICE_INCREASED';
    }
    if (newPlan.price !== undefined && newPlan.price < oldPlan.price) {
      return 'PLAN_PRICE_DECREASED';
    }
    if (
      newPlan.durationDays !== undefined &&
      newPlan.durationDays !== oldPlan.durationDays
    ) {
      return 'PLAN_DURATION_CHANGED';
    }
    return 'PLAN_UPDATED_GENERAL';
  }

  /**
   * 알림 메시지 생성
   */
  private generateNotificationMessage(
    notificationType: string,
    tierCode: string, // tierName -> tierCode
  ): string {
    switch (notificationType) {
      case 'PLAN_PRICE_INCREASED':
        return `${tierCode} 플랜의 가격이 인상되었습니다.`;
      case 'PLAN_PRICE_DECREASED':
        return `${tierCode} 플랜의 가격이 인하되었습니다.`;
      case 'PLAN_DURATION_CHANGED':
        return `${tierCode} 플랜의 이용 기간이 변경되었습니다.`;
      default:
        return `${tierCode} 플랜이 업데이트되었습니다.`;
    }
  }
}
