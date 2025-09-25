import {
  Controller,
  Post,
  Put,
  Delete,
  Get,
  Body,
  Param,
  UseFilters,
  HttpStatus,
  HttpCode,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AdminOperationsService } from './admin-operations.service';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';
import { DevAuthGuard } from '../auth/dev-auth.guard'; // 🚨 개발용 임시 가드
import {
  CreateTierRequest,
  UpdateTierRequest,
  CreatePlanRequest,
  UpdatePlanRequest,
  DeactivatePlanRequest,
  CreatePolicyRequest,
  UpdatePolicyRequest,
  ExtendEntitlementRequest,
  CreateTierRequestSchema,
  UpdateTierRequestSchema,
  CreatePlanRequestSchema,
  UpdatePlanRequestSchema,
  DeactivatePlanRequestSchema,
  CreatePolicyRequestSchema,
  UpdatePolicyRequestSchema,
  ExtendEntitlementRequestSchema,
} from '../shared/schemas';
import { FastifyRequest } from 'fastify';
/**
 * 관리자 운영 컨트롤러
 * 🚨 [주의] 현재 개발용 임시 인증 가드(DevAuthGuard)를 사용하고 있습니다.
 */
@Controller('admin')
@UseGuards(DevAuthGuard) // 모든 API에 관리자 인증 가드 적용
@UseFilters(SubscriptionExceptionFilter)
export class AdminOperationsController {
  constructor(
    private readonly adminOperationsService: AdminOperationsService,
  ) {}

  // ===================================================================
  // Plan & Tier Management
  // ===================================================================

  @Post('tiers')
  @HttpCode(HttpStatus.CREATED)
  async createTier(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(CreateTierRequestSchema))
    dto: CreateTierRequest,
  ) {
    const adminId = req.user!.userId;
    return this.adminOperationsService.createTier(dto, adminId);
  }

  @Put('tiers/:tierId')
  async updateTier(
    @Req() req: FastifyRequest,
    @Param('tierId') tierId: string,
    @Body(new ZodValidationPipe(UpdateTierRequestSchema))
    dto: UpdateTierRequest,
  ) {
    const adminId = req.user!.userId;
    return this.adminOperationsService.updateTier(tierId, dto, adminId);
  }

  @Post('plans')
  @HttpCode(HttpStatus.CREATED)
  async createPlan(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(CreatePlanRequestSchema))
    dto: CreatePlanRequest,
  ) {
    const adminId = req.user!.userId;
    return this.adminOperationsService.createPlan(dto, adminId);
  }

  @Put('plans/:planId')
  async updatePlan(
    @Req() req: FastifyRequest,
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(UpdatePlanRequestSchema))
    dto: UpdatePlanRequest,
  ) {
    const adminId = req.user!.userId;
    return this.adminOperationsService.updatePlan(planId, dto, adminId);
  }

  @Delete('plans/:planId')
  async deactivatePlan(
    @Req() req: FastifyRequest,
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(DeactivatePlanRequestSchema))
    dto: DeactivatePlanRequest,
  ) {
    const adminId = req.user!.userId;
    return this.adminOperationsService.deactivatePlan(planId, dto, adminId);
  }

  // ===================================================================
  // Policy Management
  // ===================================================================

  @Post('policies')
  @HttpCode(HttpStatus.CREATED)
  async createPolicy(
    @Body(new ZodValidationPipe(CreatePolicyRequestSchema))
    dto: CreatePolicyRequest,
  ) {
    return this.adminOperationsService.createPolicy(dto);
  }

  @Put('policies/:policyId')
  async updatePolicy(
    @Param('policyId') policyId: string,
    @Body(new ZodValidationPipe(UpdatePolicyRequestSchema))
    dto: UpdatePolicyRequest,
  ) {
    return this.adminOperationsService.updatePolicy(policyId, dto);
  }

  @Delete('policies/:policyId')
  async deactivatePolicy(@Param('policyId') policyId: string) {
    return this.adminOperationsService.deactivatePolicy(policyId);
  }

  // ===================================================================
  // Entitlement Management - 구독 권한 관리
  // ===================================================================

  @Post('entitlements/adjust')
  @HttpCode(HttpStatus.OK)
  async adjustUserEntitlement(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(ExtendEntitlementRequestSchema))
    dto: ExtendEntitlementRequest,
  ) {
    const adminId = req.user!.userId;
    return this.adminOperationsService.adjustUserEntitlement(dto, adminId);
  }

  @Get('users/:userId/pause-history')
  async getUserPauseHistory(@Param('userId') userId: string) {
    return this.adminOperationsService.getUserPauseHistory(userId);
  }

  // =================================================================
  // 정기결제 테스트 엔드포인트 (임시)
  // =================================================================

  @Post('billing/process-due')
  async processDueBillings() {
    // 임시로 간단한 응답 반환
    return {
      message: '정기결제 스케줄러는 매 5분마다 자동 실행됩니다',
      status: '스케줄러가 백그라운드에서 실행 중입니다',
      nextRun: '다음 5분 간격',
      testData: 'quick-test-setup.sql을 실행하여 테스트 데이터를 준비해주세요',
    };
  }
}
