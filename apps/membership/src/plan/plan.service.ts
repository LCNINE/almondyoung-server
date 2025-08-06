import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, desc } from 'drizzle-orm';
import * as schema from '../shared/schemas/entities/schema';
import { PlanNotFoundException } from '../shared/exceptions/subscription.exceptions';
import type {
  Tier,
  Plan,
  CreateTierInput,
  UpdateTierInput,
  CreatePlanInput,
  UpdatePlanInput,
  PlanDetailsResponse,
  TierBenefits,
  TierListResponse,
} from '../shared/schemas';

@Injectable()
export class PlanService {
  constructor(private readonly dbService: DbService<typeof schema>) { }

  /**
   * Retrieves all active subscription plans with their tier information.
   *
   * @returns Promise<PlanWithTier[]> Array of active plans with tier details
   * @throws {Error} Database connection or query errors
   */
  async getAllPlans(): Promise<any[]> {
    const plans = await this.dbService.db
      .select({
        plan: schema.subscriptionPlans,
        tier: schema.subscriptionTiers,
      })
      .from(schema.subscriptionPlans)
      .innerJoin(
        schema.subscriptionTiers,
        eq(schema.subscriptionPlans.tierId, schema.subscriptionTiers.id),
      )
      .where(eq(schema.subscriptionPlans.isActive, true))
      .orderBy(schema.subscriptionTiers.priorityLevel);

    return plans.map(({ plan, tier }) => ({
      id: plan.id,
      tierId: tier.id,
      tierCode: tier.code,
      tierName: tier.name,
      priorityLevel: tier.priorityLevel,
      price: plan.price,
      durationDays: plan.durationDays,
      currency: plan.currency,
      trialDays: plan.trialDays,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    }));
  }

  /**
   * Retrieves detailed information for a specific subscription plan.
   *
   * @param planId - The UUID of the plan to retrieve
   * @returns Promise<PlanWithTier> Detailed plan information with tier data
   * @throws {PlanNotFoundException} When the plan is not found or inactive
   */
  async getPlanDetails(planId: string): Promise<PlanDetailsResponse> {
    const result = await this.dbService.db
      .select({
        plan: schema.subscriptionPlans,
        tier: schema.subscriptionTiers,
      })
      .from(schema.subscriptionPlans)
      .innerJoin(
        schema.subscriptionTiers,
        eq(schema.subscriptionPlans.tierId, schema.subscriptionTiers.id),
      )
      .where(
        and(
          eq(schema.subscriptionPlans.id, planId),
          eq(schema.subscriptionPlans.isActive, true),
        ),
      )
      .limit(1);

    if (!result.length) {
      throw new PlanNotFoundException();
    }

    const { plan, tier } = result[0];

    return {
      id: plan.id,
      tier: {
        id: tier.id,
        code: tier.code,
        name: tier.name,
        priorityLevel: tier.priorityLevel,
        createdAt: tier.createdAt.toISOString(),
        updatedAt: tier.updatedAt.toISOString(),
      },
      price: plan.price,
      durationDays: plan.durationDays,
      currency: plan.currency,
      trialDays: plan.trialDays,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }

  /**
   * Retrieves all subscription tiers ordered by priority level.
   *
   * @returns Promise<TierListResponse> Array of all tiers sorted by priority level
   * @throws {Error} Database connection or query errors
   */
  async getAllTiers(): Promise<TierListResponse> {
    const tiers = await this.dbService.db
      .select()
      .from(schema.subscriptionTiers)
      .orderBy(schema.subscriptionTiers.priorityLevel);

    return tiers.map((tier) => ({
      id: tier.id,
      code: tier.code,
      name: tier.name,
      priorityLevel: tier.priorityLevel,
      createdAt: tier.createdAt.toISOString(),
      updatedAt: tier.updatedAt.toISOString(),
    }));
  }

  /**
   * Retrieves all active plans for a specific subscription tier.
   *
   * @param tierId - The UUID of the tier to get plans for
   * @returns Promise<Plan[]> Array of active plans for the specified tier
   * @throws {Error} Database connection or query errors
   */
  async getPlansByTier(tierId: string): Promise<any[]> {
    const plans = await this.dbService.db
      .select()
      .from(schema.subscriptionPlans)
      .where(
        and(
          eq(schema.subscriptionPlans.tierId, tierId),
          eq(schema.subscriptionPlans.isActive, true),
        ),
      )
      .orderBy(desc(schema.subscriptionPlans.createdAt));

    return plans.map((plan) => ({
      id: plan.id,
      price: plan.price,
      durationDays: plan.durationDays,
      currency: plan.currency,
      trialDays: plan.trialDays,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    }));
  }

  /**
   * Retrieves tier benefits including plans and benefit information.
   * Currently returns mock benefit data - will be extended when benefits table is added.
   *
   * @param tierId - The UUID of the tier to get benefits for
   * @returns Promise<TierBenefits> Tier information with plans and benefits
   * @throws {PlanNotFoundException} When the tier is not found
   */
  async getTierBenefits(tierId: string): Promise<TierBenefits> {
    const tier = await this.dbService.db
      .select()
      .from(schema.subscriptionTiers)
      .where(eq(schema.subscriptionTiers.id, tierId))
      .limit(1);

    if (!tier.length) {
      throw new PlanNotFoundException();
    }

    const plans = await this.getPlansByTier(tierId);

    return {
      tier: {
        id: tier[0].id,
        code: tier[0].code,
        name: tier[0].name,
        priorityLevel: tier[0].priorityLevel,
        createdAt: tier[0].createdAt.toISOString(),
        updatedAt: tier[0].updatedAt.toISOString(),
      },
      plans,
      // 추후 혜택 테이블이 추가되면 여기에 혜택 정보 포함
      benefits: [
        // 예시 데이터 - 실제로는 별도 테이블에서 조회
        {
          type: 'storage',
          description: `${tier[0].name} 티어 스토리지 혜택`,
          value: tier[0].priorityLevel * 10 + 'GB',
        },
        {
          type: 'support',
          description: `${tier[0].name} 티어 지원 혜택`,
          value: tier[0].priorityLevel > 2 ? '24/7 지원' : '업무시간 지원',
        },
      ],
    };
  }

  // ===== 관리자용 메서드들 =====

  /**
   * 티어 생성 (관리자용)
   */
  async createTier(createTierInput: CreateTierInput, adminId: string) {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 코드 중복 검사
      const existingTier = await tx
        .select()
        .from(schema.subscriptionTiers)
        .where(eq(schema.subscriptionTiers.code, createTierInput.code))
        .limit(1);

      if (existingTier.length > 0) {
        throw new Error(
          `티어 코드 '${createTierInput.code}'가 이미 존재합니다`,
        );
      }

      // 2. 우선순위 중복 검사
      const existingPriority = await tx
        .select()
        .from(schema.subscriptionTiers)
        .where(
          eq(
            schema.subscriptionTiers.priorityLevel,
            createTierInput.priorityLevel,
          ),
        )
        .limit(1);

      if (existingPriority.length > 0) {
        throw new Error(
          `우선순위 ${createTierInput.priorityLevel}이 이미 존재합니다`,
        );
      }

      // 3. 티어 생성
      const tierId = crypto.randomUUID();
      await tx.insert(schema.subscriptionTiers).values({
        id: tierId,
        code: createTierInput.code,
        name: createTierInput.name,
        priorityLevel: createTierInput.priorityLevel,
      });

      // 4. 이벤트 기록
      await tx.insert(schema.subscriptionEvents).values({
        id: crypto.randomUUID(),
        eventType: 'TIER_CREATED',
        userId: adminId,
        subscriptionId: undefined,
        effectiveDate: new Date().toISOString().split('T')[0],
        eventPayload: {
          tierId,
          tierData: createTierInput,
          adminId,
        },
      });

      return { tierId };
    });
  }

  /**
   * 티어 수정 (관리자용)
   */
  async updateTier(
    tierId: string,
    updateTierInput: UpdateTierInput,
    adminId: string,
  ) {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 기존 티어 조회
      const existingTier = await tx
        .select()
        .from(schema.subscriptionTiers)
        .where(eq(schema.subscriptionTiers.id, tierId))
        .limit(1);

      if (!existingTier.length) {
        throw new PlanNotFoundException();
      }

      // 2. 우선순위 중복 검사 (변경하는 경우)
      if (
        updateTierInput.priorityLevel &&
        updateTierInput.priorityLevel !== existingTier[0].priorityLevel
      ) {
        const existingPriority = await tx
          .select()
          .from(schema.subscriptionTiers)
          .where(
            eq(
              schema.subscriptionTiers.priorityLevel,
              updateTierInput.priorityLevel,
            ),
          )
          .limit(1);

        if (existingPriority.length > 0) {
          throw new Error(
            `우선순위 ${updateTierInput.priorityLevel}이 이미 존재합니다`,
          );
        }
      }

      // 3. 티어 업데이트
      await tx
        .update(schema.subscriptionTiers)
        .set({
          ...updateTierInput,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptionTiers.id, tierId));

      // 4. 이벤트 기록
      await tx.insert(schema.subscriptionEvents).values({
        id: crypto.randomUUID(),
        eventType: 'TIER_UPDATED',
        userId: adminId,
        subscriptionId: null,
        effectiveDate: new Date().toISOString().split('T')[0],
        eventPayload: {
          tierId,
          oldData: existingTier[0],
          newData: updateTierInput,
          adminId,
        },
      });

      return { tierId };
    });
  }

  /**
   * 플랜 생성 (관리자용)
   */
  async createPlan(createPlanInput: CreatePlanInput, adminId: string) {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 티어 존재 확인
      const tier = await tx
        .select()
        .from(schema.subscriptionTiers)
        .where(eq(schema.subscriptionTiers.id, createPlanInput.tierId))
        .limit(1);

      if (!tier.length) {
        throw new PlanNotFoundException();
      }

      // 2. 플랜 생성
      const planId = crypto.randomUUID();
      await tx.insert(schema.subscriptionPlans).values({
        id: planId,
        tierId: createPlanInput.tierId,
        price: createPlanInput.price,
        durationDays: createPlanInput.durationDays,
        currency: createPlanInput.currency || 'KRW',
        trialDays: createPlanInput.trialDays || 0,
        isActive: true,
      });

      // 3. 이벤트 기록
      await tx.insert(schema.subscriptionEvents).values({
        id: crypto.randomUUID(),
        eventType: 'PLAN_CREATED',
        userId: adminId,
        subscriptionId: null,
        effectiveDate: new Date().toISOString().split('T')[0],
        eventPayload: {
          planId,
          planData: createPlanInput,
          tierInfo: tier[0],
          adminId,
        },
      });

      return { planId };
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
      // 1. 기존 플랜 조회
      const existingPlan = await tx
        .select({
          plan: schema.subscriptionPlans,
          tier: schema.subscriptionTiers,
        })
        .from(schema.subscriptionPlans)
        .innerJoin(
          schema.subscriptionTiers,
          eq(schema.subscriptionPlans.tierId, schema.subscriptionTiers.id),
        )
        .where(eq(schema.subscriptionPlans.id, planId))
        .limit(1);

      if (!existingPlan.length) {
        throw new PlanNotFoundException();
      }

      const { plan: oldPlan, tier } = existingPlan[0];

      // 2. 플랜 업데이트
      await tx
        .update(schema.subscriptionPlans)
        .set({
          ...updatePlanInput,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptionPlans.id, planId));

      // 3. 이벤트 기록
      await tx.insert(schema.subscriptionEvents).values({
        id: crypto.randomUUID(),
        eventType: 'PLAN_UPDATED',
        userId: adminId,
        subscriptionId: null,
        effectiveDate: new Date().toISOString().split('T')[0],
        eventPayload: {
          planId,
          oldData: oldPlan,
          newData: updatePlanInput,
          tierInfo: tier,
          adminId,
        },
      });

      // 4. 기존 구독자들에게 알림 이벤트 발행
      await this.notifySubscribersOfPlanChange(
        tx,
        planId,
        oldPlan,
        updatePlanInput,
        tier,
      );

      return { planId };
    });
  }

  /**
   * 플랜 비활성화 (관리자용)
   */
  async deactivatePlan(planId: string, reason: string, adminId: string) {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 기존 플랜 조회
      const existingPlan = await tx
        .select({
          plan: schema.subscriptionPlans,
          tier: schema.subscriptionTiers,
        })
        .from(schema.subscriptionPlans)
        .innerJoin(
          schema.subscriptionTiers,
          eq(schema.subscriptionPlans.tierId, schema.subscriptionTiers.id),
        )
        .where(eq(schema.subscriptionPlans.id, planId))
        .limit(1);

      if (!existingPlan.length) {
        throw new PlanNotFoundException();
      }

      // 2. 플랜 비활성화 (Soft Delete)
      await tx
        .update(schema.subscriptionPlans)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptionPlans.id, planId));

      // 3. 이벤트 기록
      await tx.insert(schema.subscriptionEvents).values({
        id: crypto.randomUUID(),
        eventType: 'PLAN_DEACTIVATED',
        userId: adminId,
        subscriptionId: null,
        effectiveDate: new Date().toISOString().split('T')[0],
        eventPayload: {
          planId,
          reason,
          planData: existingPlan[0].plan,
          tierInfo: existingPlan[0].tier,
          adminId,
        },
      });

      return { planId };
    });
  }

  /**
   * 플랜 변경 시 기존 구독자들에게 알림
   */
  private async notifySubscribersOfPlanChange(
    tx: any,
    planId: string,
    oldPlan: Plan,
    newPlan: UpdatePlanInput,
    tier: Tier,
  ) {
    // 해당 플랜을 사용하는 활성 구독자들 조회
    const activeSubscribers = await tx
      .select({
        userId: schema.subscriptions.userId,
        subscriptionId: schema.subscriptions.id,
      })
      .from(schema.subscriptions)
      .where(
        and(
          eq(schema.subscriptions.planId, planId),
          eq(schema.subscriptions.status, 'ACTIVE'),
        ),
      );

    // 각 구독자에게 알림 이벤트 생성
    for (const subscriber of activeSubscribers) {
      const notificationType = this.determineNotificationType(oldPlan, newPlan);

      await tx.insert(schema.subscriptionEvents).values({
        id: crypto.randomUUID(),
        eventType: notificationType,
        userId: subscriber.userId,
        subscriptionId: subscriber.subscriptionId,
        effectiveDate: new Date().toISOString().split('T')[0],
        eventPayload: {
          planId,
          oldPlan,
          newPlan,
          tierInfo: tier,
          message: this.generateNotificationMessage(
            notificationType,
            tier.name,
          ),
        },
      });
    }
  }

  /**
   * 알림 타입 결정
   */
  private determineNotificationType(oldPlan: any, newPlan: any): string {
    if (newPlan.price && newPlan.price > oldPlan.price) {
      return 'PLAN_PRICE_INCREASED';
    }
    if (newPlan.price && newPlan.price < oldPlan.price) {
      return 'PLAN_PRICE_DECREASED';
    }
    if (newPlan.durationDays && newPlan.durationDays !== oldPlan.durationDays) {
      return 'PLAN_DURATION_CHANGED';
    }
    return 'PLAN_UPDATED_GENERAL';
  }

  /**
   * 알림 메시지 생성
   */
  private generateNotificationMessage(
    notificationType: string,
    tierName: string,
  ): string {
    switch (notificationType) {
      case 'PLAN_PRICE_INCREASED':
        return `${tierName} 플랜의 가격이 인상되었습니다. 더 나은 혜택을 확인해보세요!`;
      case 'PLAN_PRICE_DECREASED':
        return `${tierName} 플랜의 가격이 인하되었습니다. 지금이 업그레이드 기회입니다!`;
      case 'PLAN_DURATION_CHANGED':
        return `${tierName} 플랜의 이용 기간이 변경되었습니다.`;
      default:
        return `${tierName} 플랜이 업데이트되었습니다. 새로운 혜택을 확인해보세요!`;
    }
  }
}
