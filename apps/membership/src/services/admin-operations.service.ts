import { Injectable } from '@nestjs/common';
import { PlanService } from './plan.service';
import { SubscriptionService } from './subscription.service';
import { SubscriptionCancellationService } from './subscription-cancellation.service';
import { EntitlementService } from './entitlement.service';
import { PauseService } from './pause.service';
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
 * 관리자용 오케스트레이션 서비스 (Business Layer)
 *
 * 역할: 관리자 작업을 위한 서비스 오케스트레이션
 * - 각 도메인 서비스를 호출하여 관리자 작업 수행
 * - 자체 비즈니스 로직 최소화
 * - 각 서비스에 역할 위임
 *
 * 참고: 이 서비스는 이미 올바른 패턴을 따르고 있습니다.
 */
@Injectable()
export class AdminOperationsService {
  constructor(
    private readonly planService: PlanService,
    private readonly subscriptionService: SubscriptionService,
    private readonly cancellationService: SubscriptionCancellationService,
    private readonly entitlementService: EntitlementService,
    private readonly pauseService: PauseService,
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

  async deactivatePlan(planId: string, dto: DeactivatePlanRequest, adminId: string) {
    return this.planService.deactivatePlan(planId, dto.reason, adminId);
  }

  // =================================================================
  // Policy Management
  // =================================================================

  // =================================================================
  // User & Subscription Management (필요 시 추가)
  // =================================================================

  /**
   * 강제 구독 취소 (관리자 전용)
   *
   * ✅ 흐름만 표현: "CancellationService 호출"
   */
  async forceCancelSubscription(
    contractId: string,
    adminId: string,
    reason: string,
    refundType: 'FULL' | 'PARTIAL' | 'NONE',
    partialRefundAmount?: number,
    refundReason?: string,
  ) {
    return this.cancellationService.forceCancelSubscription(
      contractId,
      adminId,
      reason,
      refundType,
      partialRefundAmount,
      refundReason,
    );
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
    return await this.entitlementService.adjustEntitlement(dto.userId, dto.days, dto.reason, adminId);
  }

  /**
   * 사용자의 일시정지 이력을 조회합니다.
   *
   * ✅ 흐름만 표현: "일시정지 이력 조회"
   */
  async getUserPauseHistory(userId: string) {
    return this.pauseService.getPauseHistory(userId);
  }
}
