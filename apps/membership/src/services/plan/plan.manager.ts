import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { DrizzleTransaction } from '../../shared/schemas/types';
import type { CreateTierInput, UpdateTierInput, CreatePlanInput, UpdatePlanInput } from '../../shared/schemas';

export interface CreateTierResult {
  tierId: string;
}

export interface CreatePlanResult {
  planId: string;
}

/**
 * PlanManager (Implementation Layer)
 *
 * 역할: 플랜 및 티어 생성/수정/비활성화
 * - 티어 생성/수정
 * - 플랜 생성/수정/비활성화
 * - 이벤트 배치 기록
 */
@Injectable()
export class PlanManager {
  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 티어 생성
   */
  async createTier(createTierInput: CreateTierInput, adminId: string): Promise<CreateTierResult> {
    return this.dbService.db.transaction(async (tx: DrizzleTransaction) => {
      // 1. 새로운 티어 생성
      const [newTier] = await tx.insert(schema.tiers).values(createTierInput).returning({ id: schema.tiers.id });

      // 2. 이벤트 배치 기록
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
   * 티어 수정
   */
  async updateTier(tierId: string, updateTierInput: UpdateTierInput, adminId: string): Promise<{ tierId: string }> {
    return this.dbService.db.transaction(async (tx: DrizzleTransaction) => {
      // 1. 티어 정보 업데이트
      await tx
        .update(schema.tiers)
        .set({
          ...updateTierInput,
          updatedAt: new Date(),
        })
        .where(eq(schema.tiers.id, tierId));

      // 2. 이벤트 배치 기록
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
   * 플랜 생성
   */
  async createPlan(createPlanInput: CreatePlanInput, adminId: string): Promise<CreatePlanResult> {
    return this.dbService.db.transaction(async (tx: DrizzleTransaction) => {
      // 1. 새로운 플랜 생성
      const [newPlan] = await tx
        .insert(schema.plan)
        .values({ ...createPlanInput, isActive: true })
        .returning();

      // 2. 이벤트 배치 기록
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
   * 플랜 수정
   */
  async updatePlan(planId: string, updatePlanInput: UpdatePlanInput, adminId: string): Promise<{ planId: string }> {
    return this.dbService.db.transaction(async (tx: DrizzleTransaction) => {
      // 1. 플랜 데이터 업데이트
      await tx
        .update(schema.plan)
        .set({
          ...updatePlanInput,
          updatedAt: new Date(),
        })
        .where(eq(schema.plan.id, planId));

      // 2. 이벤트 배치 기록
      await tx.insert(schema.eventBatches).values({
        id: crypto.randomUUID(),
        type: 'PLAN_UPDATED',
        adminId: adminId,
        effectiveDate: new Date().toISOString().split('T')[0],
      });

      return { planId };
    });
  }

  /**
   * 플랜 비활성화
   */
  async deactivatePlan(planId: string, adminId: string): Promise<{ planId: string }> {
    return this.dbService.db.transaction(async (tx: DrizzleTransaction) => {
      // 1. 플랜 비활성화 (soft delete)
      await tx
        .update(schema.plan)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.plan.id, planId));

      // 2. 이벤트 배치 기록
      await tx.insert(schema.eventBatches).values({
        id: crypto.randomUUID(),
        type: 'PLAN_DEACTIVATED',
        adminId: adminId,
        effectiveDate: new Date().toISOString().split('T')[0],
      });

      return { planId };
    });
  }
}
