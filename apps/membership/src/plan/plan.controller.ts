import { Controller, Get, Param, UseFilters } from '@nestjs/common';
import { PlanService } from './plan.service';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';

/**
 * 플랜 및 티어 관리 컨트롤러
 */
@Controller()
@UseFilters(SubscriptionExceptionFilter)
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  /**
   * 모든 활성 플랜 목록 조회
   */
  @Get('plans')
  async getAllPlans() {
    return this.planService.getAllPlans();
  }

  /**
   * 특정 플랜 상세 조회
   */
  @Get('plans/:planId')
  async getPlanDetails(@Param('planId') planId: string) {
    return this.planService.getPlanDetails(planId);
  }

  /**
   * 모든 티어 목록 조회
   */
  @Get('tiers')
  async getAllTiers() {
    return this.planService.getAllTiers();
  }

  /**
   * 특정 티어의 모든 플랜 조회
   */
  @Get('tiers/:tierId/plans')
  async getPlansByTier(@Param('tierId') tierId: string) {
    return this.planService.getPlansByTier(tierId);
  }

  /**
   * 티어별 혜택 조회
   */
  @Get('tiers/:tierId/benefits')
  async getTierBenefits(@Param('tierId') tierId: string) {
    return this.planService.getTierBenefits(tierId);
  }
}
