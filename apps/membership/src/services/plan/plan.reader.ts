import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, desc } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import type { Plan, Tier } from '../../shared/schemas';

export interface PlanWithTier {
  plan: Plan;
  tier: Tier;
}

export interface TierWithPlans {
  tier: Tier;
  plans: Plan[];
}

/**
 * PlanReader (Implementation Layer)
 *
 * 역할: 플랜 및 티어 조회
 * - 활성 플랜 목록 조회
 * - 플랜 상세 정보 조회
 * - 티어 목록 조회
 * - 티어별 플랜 조회
 */
@Injectable()
export class PlanReader {
  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 모든 활성 플랜 조회 (티어 정보 포함)
   */
  async findAllActivePlans(): Promise<PlanWithTier[]> {
    return this.dbService.db
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
   * 특정 플랜 상세 정보 조회 (티어 정보 포함)
   */
  async findPlanById(planId: string): Promise<PlanWithTier | null> {
    const result = await this.dbService.db
      .select({
        plan: schema.plan,
        tier: schema.tiers,
      })
      .from(schema.plan)
      .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .where(and(eq(schema.plan.id, planId), eq(schema.plan.isActive, true)))
      .limit(1);

    return result.length ? result[0] : null;
  }

  /**
   * 모든 티어 조회 (우선순위 순)
   */
  async findAllTiers(): Promise<Tier[]> {
    return this.dbService.db
      .select()
      .from(schema.tiers)
      .orderBy(schema.tiers.priorityLevel);
  }

  /**
   * 특정 티어의 활성 플랜 목록 조회
   */
  async findPlansByTierId(tierId: string): Promise<Plan[]> {
    return this.dbService.db
      .select()
      .from(schema.plan)
      .where(
        and(eq(schema.plan.tierId, tierId), eq(schema.plan.isActive, true)),
      )
      .orderBy(desc(schema.plan.createdAt));
  }

  /**
   * 티어와 해당 플랜 목록 조회
   */
  async findTierWithPlans(tierId: string): Promise<TierWithPlans | null> {
    const tier = await this.dbService.db
      .select()
      .from(schema.tiers)
      .where(eq(schema.tiers.id, tierId))
      .limit(1);

    if (!tier.length) {
      return null;
    }

    const plans = await this.findPlansByTierId(tierId);

    return {
      tier: tier[0],
      plans,
    };
  }

  /**
   * 티어 코드로 존재 여부 확인
   */
  async existsByTierCode(code: string): Promise<boolean> {
    const [result] = await this.dbService.db
      .select({ id: schema.tiers.id })
      .from(schema.tiers)
      .where(eq(schema.tiers.code, code))
      .limit(1);

    return !!result;
  }

  /**
   * 우선순위 레벨로 존재 여부 확인
   */
  async existsByPriorityLevel(priorityLevel: number): Promise<boolean> {
    const [result] = await this.dbService.db
      .select({ id: schema.tiers.id })
      .from(schema.tiers)
      .where(eq(schema.tiers.priorityLevel, priorityLevel))
      .limit(1);

    return !!result;
  }

  /**
   * 티어 ID로 조회
   */
  async findTierById(tierId: string): Promise<Tier | null> {
    const [tier] = await this.dbService.db
      .select()
      .from(schema.tiers)
      .where(eq(schema.tiers.id, tierId))
      .limit(1);

    return tier || null;
  }

  /**
   * 플랜 ID로 조회 (활성 여부 무관)
   */
  async findPlanByIdAny(planId: string): Promise<Plan | null> {
    const [plan] = await this.dbService.db
      .select()
      .from(schema.plan)
      .where(eq(schema.plan.id, planId))
      .limit(1);

    return plan || null;
  }
}
