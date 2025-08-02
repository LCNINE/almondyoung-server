import { Injectable } from '@nestjs/common';
import { PlanService } from '../plan/plan.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { EventPublisherService } from '@app/events';
import {
  CreateTierRequest,
  UpdateTierRequest,
  CreatePlanRequest,
  UpdatePlanRequest,
  DeactivatePlanRequest,
  CreateTierInput,
  UpdateTierInput,
  CreatePlanInput,
  UpdatePlanInput,
} from '../shared/schemas';

@Injectable()
export class AdminOperationsService {
  constructor(
    private readonly planService: PlanService,
    private readonly subscriptionService: SubscriptionService,
    private readonly eventPublisher: EventPublisherService,
  ) {}

  /**
   * 티어 생성 (관리자용)
   */
  async createTier(createTierRequest: CreateTierRequest, adminId: string) {
    try {
      // 1. 비즈니스 로직 검증
      await this.validateTierCreation(createTierRequest);

      // 2. PlanService를 통해 티어 생성
      const createTierInput: CreateTierInput = {
        code: createTierRequest.code,
        name: createTierRequest.name,
        priorityLevel: createTierRequest.priorityLevel,
      };
      const result = await this.planService.createTier(
        createTierInput,
        adminId,
      );

      // 3. 성공 이벤트 발행
      await this.publishAdminActionEvent('TIER_CREATED', {
        adminId,
        tierId: result.tierId,
        tierData: createTierRequest,
      });

      return {
        success: true,
        tierId: result.tierId,
        message: `티어 '${createTierRequest.name}'이 성공적으로 생성되었습니다.`,
      };
    } catch (error) {
      // 4. 실패 이벤트 발행
      await this.publishAdminActionEvent('TIER_CREATION_FAILED', {
        adminId,
        tierData: createTierRequest,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * 티어 수정 (관리자용)
   */
  async updateTier(
    tierId: string,
    updateTierRequest: UpdateTierRequest,
    adminId: string,
  ) {
    try {
      // 1. 기존 티어 존재 확인
      const existingTier = await this.planService.getAllTiers();
      const tierExists = existingTier.find((tier) => tier.id === tierId);

      if (!tierExists) {
        throw new Error('존재하지 않는 티어입니다.');
      }

      // 2. 영향 분석
      const impactAnalysis = await this.analyzeTierUpdateImpact(
        tierId,
        updateTierRequest,
      );

      // 3. PlanService를 통해 티어 수정
      const updateTierInput: UpdateTierInput = {
        ...(updateTierRequest.name && { name: updateTierRequest.name }),
        ...(updateTierRequest.priorityLevel && {
          priorityLevel: updateTierRequest.priorityLevel,
        }),
      };
      const result = await this.planService.updateTier(
        tierId,
        updateTierInput,
        adminId,
      );

      // 4. 성공 이벤트 발행
      await this.publishAdminActionEvent('TIER_UPDATED', {
        adminId,
        tierId,
        oldData: tierExists,
        newData: updateTierRequest,
        impactAnalysis,
      });

      return {
        success: true,
        tierId: result.tierId,
        message: `티어가 성공적으로 수정되었습니다.`,
        impactAnalysis,
      };
    } catch (error) {
      await this.publishAdminActionEvent('TIER_UPDATE_FAILED', {
        adminId,
        tierId,
        updateData: updateTierRequest,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * 플랜 생성 (관리자용)
   */
  async createPlan(createPlanRequest: CreatePlanRequest, adminId: string) {
    try {
      // 1. 비즈니스 로직 검증
      await this.validatePlanCreation(createPlanRequest);

      // 2. PlanService를 통해 플랜 생성
      const createPlanInput: CreatePlanInput = {
        tierId: createPlanRequest.tierId,
        price: createPlanRequest.price,
        durationDays: createPlanRequest.durationDays,
        currency: createPlanRequest.currency,
        trialDays: createPlanRequest.trialDays,
      };
      const result = await this.planService.createPlan(
        createPlanInput,
        adminId,
      );

      // 3. 성공 이벤트 발행
      await this.publishAdminActionEvent('PLAN_CREATED', {
        adminId,
        planId: result.planId,
        planData: createPlanRequest,
      });

      return {
        success: true,
        planId: result.planId,
        message: '플랜이 성공적으로 생성되었습니다.',
      };
    } catch (error) {
      await this.publishAdminActionEvent('PLAN_CREATION_FAILED', {
        adminId,
        planData: createPlanRequest,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * 플랜 수정 (관리자용)
   */
  async updatePlan(
    planId: string,
    updatePlanRequest: UpdatePlanRequest,
    adminId: string,
  ) {
    try {
      // 1. 기존 플랜 존재 확인
      const existingPlan = await this.planService.getPlanDetails(planId);

      // 2. 영향 분석 - 해당 플랜을 사용하는 구독자 수 확인
      const impactAnalysis = await this.analyzePlanUpdateImpact(
        planId,
        updatePlanRequest,
      );

      // 3. PlanService를 통해 플랜 수정
      const updatePlanInput: UpdatePlanInput = {
        ...(updatePlanRequest.price !== undefined && {
          price: updatePlanRequest.price,
        }),
        ...(updatePlanRequest.durationDays && {
          durationDays: updatePlanRequest.durationDays,
        }),
        ...(updatePlanRequest.currency && {
          currency: updatePlanRequest.currency,
        }),
        ...(updatePlanRequest.trialDays !== undefined && {
          trialDays: updatePlanRequest.trialDays,
        }),
        ...(updatePlanRequest.isActive !== undefined && {
          isActive: updatePlanRequest.isActive,
        }),
      };
      const result = await this.planService.updatePlan(
        planId,
        updatePlanInput,
        adminId,
      );

      // 4. 성공 이벤트 발행
      await this.publishAdminActionEvent('PLAN_UPDATED', {
        adminId,
        planId,
        oldData: existingPlan,
        newData: updatePlanRequest,
        impactAnalysis,
      });

      return {
        success: true,
        planId: result.planId,
        message: '플랜이 성공적으로 수정되었습니다.',
        impactAnalysis,
      };
    } catch (error) {
      await this.publishAdminActionEvent('PLAN_UPDATE_FAILED', {
        adminId,
        planId,
        updateData: updatePlanRequest,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * 플랜 비활성화 (관리자용)
   */
  async deactivatePlan(
    planId: string,
    deactivatePlanRequest: DeactivatePlanRequest,
    adminId: string,
  ) {
    try {
      // 1. 기존 플랜 존재 확인
      const existingPlan = await this.planService.getPlanDetails(planId);

      // 2. 영향 분석 - 활성 구독자 확인
      const impactAnalysis = await this.analyzePlanDeactivationImpact(planId);

      // 3. PlanService를 통해 플랜 비활성화
      const result = await this.planService.deactivatePlan(
        planId,
        deactivatePlanRequest.reason,
        adminId,
      );

      // 4. 성공 이벤트 발행
      await this.publishAdminActionEvent('PLAN_DEACTIVATED', {
        adminId,
        planId,
        planData: existingPlan,
        reason: deactivatePlanRequest.reason,
        impactAnalysis,
      });

      return {
        success: true,
        planId: result.planId,
        message: '플랜이 성공적으로 비활성화되었습니다.',
        impactAnalysis,
      };
    } catch (error) {
      await this.publishAdminActionEvent('PLAN_DEACTIVATION_FAILED', {
        adminId,
        planId,
        reason: deactivatePlanRequest.reason,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * 티어 생성 검증
   */
  private async validateTierCreation(createTierRequest: CreateTierRequest) {
    // 추가적인 비즈니스 로직 검증
    if (
      createTierRequest.priorityLevel < 1 ||
      createTierRequest.priorityLevel > 100
    ) {
      throw new Error('우선순위는 1-100 사이의 값이어야 합니다.');
    }

    // 티어 코드 형식 검증
    if (!/^[A-Z_]+$/.test(createTierRequest.code)) {
      throw new Error('티어 코드는 대문자와 언더스코어만 사용할 수 있습니다.');
    }
  }

  /**
   * 플랜 생성 검증
   */
  private async validatePlanCreation(createPlanRequest: CreatePlanRequest) {
    // 가격 검증
    if (createPlanRequest.price < 0) {
      throw new Error('가격은 0 이상이어야 합니다.');
    }

    // 기간 검증
    if (createPlanRequest.durationDays < 1) {
      throw new Error('기간은 1일 이상이어야 합니다.');
    }

    // 무료 체험 기간 검증
    if (
      createPlanRequest.trialDays &&
      createPlanRequest.trialDays >= createPlanRequest.durationDays
    ) {
      throw new Error('무료 체험 기간은 전체 기간보다 짧아야 합니다.');
    }
  }

  /**
   * 티어 수정 영향 분석
   */
  private async analyzeTierUpdateImpact(
    tierId: string,
    updateTierRequest: UpdateTierRequest,
  ) {
    // 해당 티어를 사용하는 플랜 수 조회
    const plans = await this.planService.getPlansByTier(tierId);

    return {
      affectedPlansCount: plans.length,
      affectedPlans: plans.map((plan) => ({
        id: plan.id,
        price: plan.price,
        durationDays: plan.durationDays,
      })),
      changes: updateTierRequest,
    };
  }

  /**
   * 플랜 수정 영향 분석
   */
  private async analyzePlanUpdateImpact(
    planId: string,
    updatePlanRequest: UpdatePlanRequest,
  ) {
    // 실제로는 SubscriptionService를 통해 해당 플랜을 사용하는 구독자 수를 조회해야 함
    // 현재는 간단한 예시로 구현

    return {
      estimatedAffectedSubscribers: 0, // 실제 구현 시 구독자 수 조회
      priceChange: updatePlanRequest.price
        ? 'PRICE_UPDATED'
        : 'NO_PRICE_CHANGE',
      durationChange: updatePlanRequest.durationDays
        ? 'DURATION_UPDATED'
        : 'NO_DURATION_CHANGE',
      changes: updatePlanRequest,
    };
  }

  /**
   * 플랜 비활성화 영향 분석
   */
  private async analyzePlanDeactivationImpact(planId: string) {
    return {
      estimatedAffectedSubscribers: 0, // 실제 구현 시 활성 구독자 수 조회
      alternativePlans: [], // 대안 플랜 추천
      warning: '플랜 비활성화 후에는 새로운 구독을 받을 수 없습니다.',
    };
  }

  /**
   * 관리자 액션 이벤트 발행
   */
  private async publishAdminActionEvent(eventType: string, payload: any) {
    try {
      // 실제 구현 시 EventPublisherService를 통해 Kafka로 이벤트 발행
      // 현재는 로그만 출력
      console.log(`Admin Event: ${eventType}`, payload);

      // await this.eventPublisher.publishEvent(eventType, {
      //   ...payload,
      //   timestamp: new Date().toISOString(),
      // });
    } catch (error) {
      console.error('Failed to publish admin action event:', error);
      // 이벤트 발행 실패는 주요 로직에 영향을 주지 않도록 처리
    }
  }
}
