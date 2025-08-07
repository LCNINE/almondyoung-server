import { Injectable } from '@nestjs/common';
import { PlanService } from '../plan/plan.service';
import { PolicyManagementService } from '../policy-management/policy-management.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { EntitlementService } from '../subscription/entitlement.service';
import {
  CreateTierRequest,
  UpdateTierRequest,
  CreatePlanRequest,
  UpdatePlanRequest,
  DeactivatePlanRequest,
  CreatePolicyRequest,
  UpdatePolicyRequest,
  ExtendEntitlementRequest,
} from '../shared/schemas';

/**
 * 관리자용 오케스트레이션 서비스
 * 각 도메인 서비스(Plan, Policy 등)를 호출하여 관리자 작업을 수행합니다.
 * 이 서비스는 자체적인 비즈니스 로직을 최소화하고, 각 서비스에 역할을 위임합니다.
 */
@Injectable()
export class AdminOperationsService {
  constructor(
    private readonly planService: PlanService,
    private readonly policyService: PolicyManagementService,
    private readonly subscriptionService: SubscriptionService,
    private readonly entitlementService: EntitlementService,
  ) {}

  // =================================================================
  // Plan & Tier Management
  // =================================================================

  async createTier(dto: CreateTierRequest, adminId: string) {
    // PlanService의 createTier 메소드를 직접 호출합니다.
    // 유효성 검사 및 DB 작업은 PlanService가 책임집니다.
    return this.planService.createTier(dto, adminId);
  }

  async updateTier(tierId: string, dto: UpdateTierRequest, adminId: string) {
    return this.planService.updateTier(tierId, dto, adminId);
  }

  async createPlan(dto: CreatePlanRequest, adminId: string) {
    return this.planService.createPlan(dto, adminId);
  }

  async updatePlan(planId: string, dto: UpdatePlanRequest, adminId: string) {
    return this.planService.updatePlan(planId, dto, adminId);
  }

  async deactivatePlan(
    planId: string,
    dto: DeactivatePlanRequest,
    adminId: string,
  ) {
    return this.planService.deactivatePlan(planId, dto.reason, adminId);
  }

  // =================================================================
  // Policy Management
  // =================================================================

  async createPolicy(dto: CreatePolicyRequest) {
    // PolicyService의 createPolicy 메소드를 직접 호출합니다.
    return this.policyService.createPolicy(dto);
  }

  async updatePolicy(policyId: string, dto: UpdatePolicyRequest) {
    return this.policyService.updatePolicy(policyId, dto);
  }

  async deactivatePolicy(policyId: string) {
    return this.policyService.deactivatePolicy(policyId);
  }

  // =================================================================
  // User & Subscription Management (필요 시 추가)
  // =================================================================

  /**
   * 예시: 특정 사용자의 구독을 강제로 취소하는 관리자 기능
   */
  async forceCancelSubscription(
    userId: string,
    reason: string,
    adminId: string,
  ) {
    console.log(`Admin ${adminId} is forcing cancellation for user ${userId}`);
    // SubscriptionService의 cancelSubscription 메소드를 호출합니다.
    return this.subscriptionService.cancelSubscription(userId, reason);
  }

  // =================================================================
  // Entitlement Management - 구독 권한 관리
  // =================================================================

  /**
   * 사용자의 구독 기간을 연장하거나 차감합니다.
   * @param dto - 구독 기간 조정 요청 데이터
   * @param adminId - 관리자 ID
   */
  async adjustUserEntitlement(dto: ExtendEntitlementRequest, adminId: string) {
    const result = await this.entitlementService.adjustEntitlement(
      dto.userId,
      dto.days,
      dto.reason,
      adminId,
    );

    return {
      message: `사용자 구독 기간이 ${result.action === 'extended' ? '연장' : '차감'}되었습니다.`,
      userId: dto.userId,
      adjustedDays: result.adjustedDays,
      action: result.action,
      previousEndsAt: result.previousEndsAt,
      newEndsAt: result.newEndsAt,
      reason: dto.reason,
      adminId,
      processedAt: new Date().toISOString(),
    };
  }
}
