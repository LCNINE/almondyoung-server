import {
  Controller,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseFilters,
  UsePipes,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { AdminOperationsService } from './admin-operations.service';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';
import {
  CreateTierRequest,
  UpdateTierRequest,
  CreatePlanRequest,
  UpdatePlanRequest,
  DeactivatePlanRequest,
  CreateTierRequestSchema,
  UpdateTierRequestSchema,
  CreatePlanRequestSchema,
  UpdatePlanRequestSchema,
  DeactivatePlanRequestSchema,
} from '../shared/schemas';

/**
 * 관리자 운영 컨트롤러
 * 플랜 및 티어 관리를 위한 오케스트레이션 API
 */
@Controller('admin')
@UseFilters(SubscriptionExceptionFilter)
export class AdminOperationsController {
  constructor(
    private readonly adminOperationsService: AdminOperationsService,
  ) {}

  /**
   * 티어 생성
   */
  @Post('tiers')
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(CreateTierRequestSchema))
  async createTier(@Body() createTierRequest: CreateTierRequest) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출
    const adminId = '550e8400-e29b-41d4-a716-446655440000';

    return this.adminOperationsService.createTier(createTierRequest, adminId);
  }

  /**
   * 티어 수정
   */
  @Put('tiers/:tierId')
  @UsePipes(new ZodValidationPipe(UpdateTierRequestSchema))
  async updateTier(
    @Param('tierId') tierId: string,
    @Body() updateTierRequest: UpdateTierRequest,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출
    const adminId = '550e8400-e29b-41d4-a716-446655440000';

    return this.adminOperationsService.updateTier(
      tierId,
      updateTierRequest,
      adminId,
    );
  }

  /**
   * 플랜 생성
   */
  @Post('plans')
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(CreatePlanRequestSchema))
  async createPlan(@Body() createPlanRequest: CreatePlanRequest) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출
    const adminId = '550e8400-e29b-41d4-a716-446655440000';

    return this.adminOperationsService.createPlan(createPlanRequest, adminId);
  }

  /**
   * 플랜 수정
   */
  @Put('plans/:planId')
  @UsePipes(new ZodValidationPipe(UpdatePlanRequestSchema))
  async updatePlan(
    @Param('planId') planId: string,
    @Body() updatePlanRequest: UpdatePlanRequest,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출
    const adminId = '550e8400-e29b-41d4-a716-446655440000';

    return this.adminOperationsService.updatePlan(
      planId,
      updatePlanRequest,
      adminId,
    );
  }

  /**
   * 플랜 비활성화
   */
  @Delete('plans/:planId')
  @UsePipes(new ZodValidationPipe(DeactivatePlanRequestSchema))
  async deactivatePlan(
    @Param('planId') planId: string,
    @Body() deactivatePlanRequest: DeactivatePlanRequest,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출
    const adminId = '550e8400-e29b-41d4-a716-446655440000';

    return this.adminOperationsService.deactivatePlan(
      planId,
      deactivatePlanRequest,
      adminId,
    );
  }
}
