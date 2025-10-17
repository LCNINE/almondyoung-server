import { Injectable } from '@nestjs/common';
import { PlanReader } from './plan/plan.reader';
import { PlanManager } from './plan/plan.manager';
import type {
  CreateTierInput,
  UpdateTierInput,
  CreatePlanInput,
  UpdatePlanInput,
  Plan,
  Tier,
} from '../shared/schemas';

// 하위 호환성을 위한 타입 export
export type { PlanWithTier, TierWithPlans } from './plan/plan.reader';
export type { CreateTierResult, CreatePlanResult } from './plan/plan.manager';

/**
 * 플랜 서비스 (Business Layer)
 *
 * 역할: 비즈니스 흐름만 표현 (2-3줄)
 * - 검증 로직 없음 (Manager가 담당)
 * - 상세 구현 없음 (Manager가 담당)
 * - 협력 도구 클래스들을 중계
 */
@Injectable()
export class PlanService {
  constructor(
    private readonly planReader: PlanReader,
    private readonly planManager: PlanManager,
  ) {}

  /**
   * 모든 활성 플랜 조회
   *
   * ✅ 흐름만 표현: "플랜 목록 조회"
   */
  async getAllPlans() {
    return this.planReader.findAllActivePlans();
  }

  /**
   * 플랜 상세 정보 조회
   *
   * ✅ 흐름만 표현: "플랜 조회 → 검증"
   */
  async getPlanDetails(planId: string) {
    const plan = await this.planReader.findPlanById(planId);
    if (!plan) {
      throw new Error('Plan not found');
    }
    return plan;
  }

  /**
   * 모든 티어 조회
   *
   * ✅ 흐름만 표현: "티어 목록 조회"
   */
  async getAllTiers(): Promise<Tier[]> {
    return this.planReader.findAllTiers();
  }

  /**
   * 티어별 플랜 조회
   *
   * ✅ 흐름만 표현: "티어별 플랜 조회"
   */
  async getPlansByTier(tierId: string): Promise<Plan[]> {
    return this.planReader.findPlansByTierId(tierId);
  }

  /**
   * 티어와 플랜 목록 조회
   *
   * ✅ 흐름만 표현: "티어 조회 → 검증"
   */
  async getTierWithPlans(tierId: string) {
    const result = await this.planReader.findTierWithPlans(tierId);
    if (!result) {
      throw new Error('Tier not found');
    }
    return result;
  }

  // ===== 관리자용 메서드들 =====

  /**
   * 티어 생성 (관리자용)
   *
   * ✅ 흐름만 표현: "중복 검증 → 티어 생성"
   */
  async createTier(createTierInput: CreateTierInput, adminId: string) {
    // 중복 검증
    if (await this.planReader.existsByTierCode(createTierInput.code)) {
      throw new Error(`Tier code already exists: ${createTierInput.code}`);
    }
    if (
      await this.planReader.existsByPriorityLevel(createTierInput.priorityLevel)
    ) {
      throw new Error(
        `Priority level already exists: ${createTierInput.priorityLevel}`,
      );
    }

    return this.planManager.createTier(createTierInput, adminId);
  }

  /**
   * 티어 수정 (관리자용)
   *
   * ✅ 흐름만 표현: "티어 조회 → 중복 검증 → 티어 수정"
   */
  async updateTier(
    tierId: string,
    updateTierInput: UpdateTierInput,
    adminId: string,
  ) {
    // 티어 존재 확인
    const existingTier = await this.planReader.findTierById(tierId);
    if (!existingTier) {
      throw new Error('Tier not found');
    }

    // 우선순위 변경 시 중복 검증
    if (
      updateTierInput.priorityLevel &&
      updateTierInput.priorityLevel !== existingTier.priorityLevel
    ) {
      if (
        await this.planReader.existsByPriorityLevel(
          updateTierInput.priorityLevel,
        )
      ) {
        throw new Error(
          `Priority level already exists: ${updateTierInput.priorityLevel}`,
        );
      }
    }

    return this.planManager.updateTier(tierId, updateTierInput, adminId);
  }

  /**
   * 플랜 생성 (관리자용)
   *
   * ✅ 흐름만 표현: "티어 검증 → 플랜 생성"
   */
  async createPlan(createPlanInput: CreatePlanInput, adminId: string) {
    // 티어 존재 확인
    const tier = await this.planReader.findTierById(createPlanInput.tierId);
    if (!tier) {
      throw new Error('Tier not found');
    }

    return this.planManager.createPlan(createPlanInput, adminId);
  }

  /**
   * 플랜 수정 (관리자용)
   *
   * ✅ 흐름만 표현: "플랜 조회 → 플랜 수정"
   */
  async updatePlan(
    planId: string,
    updatePlanInput: UpdatePlanInput,
    adminId: string,
  ) {
    // 플랜 존재 확인
    const existingPlan = await this.planReader.findPlanByIdAny(planId);
    if (!existingPlan) {
      throw new Error('Plan not found');
    }

    return this.planManager.updatePlan(planId, updatePlanInput, adminId);
  }

  /**
   * 플랜 비활성화 (관리자용)
   *
   * ✅ 흐름만 표현: "플랜 조회 → 플랜 비활성화"
   */
  async deactivatePlan(planId: string, reason: string, adminId: string) {
    // 플랜 존재 확인
    const existingPlan = await this.planReader.findPlanByIdAny(planId);
    if (!existingPlan) {
      throw new Error('Plan not found');
    }

    return this.planManager.deactivatePlan(planId, adminId);
  }
}
