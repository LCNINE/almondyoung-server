import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseFilters,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { AdminOperationsService } from './admin-operations.service';
import { PolicyManagementService } from '../policy-management/policy-management.service';
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
  CreatePolicyRequest,
  UpdatePolicyRequest,
  GetPoliciesQuery,
} from '../shared/schemas';
import {
  CreatePolicyRequestSchema,
  UpdatePolicyRequestSchema,
} from '../shared/schemas/requests';
import type { PolicyResponse, PolicyListResponse } from '../shared/schemas';

/**
 * 관리자 운영 컨트롤러
 * 플랜, 티어, 정책 관리를 위한 통합 관리자 API
 */
@Controller('admin')
@UseFilters(SubscriptionExceptionFilter)
export class AdminOperationsController {
  constructor(
    private readonly adminOperationsService: AdminOperationsService,
    private readonly policyManagementService: PolicyManagementService,
  ) {}

  /**
   * 티어 생성
   */
  @Post('tiers')
  @HttpCode(HttpStatus.CREATED)
  async createTier(
    @Body(new ZodValidationPipe(CreateTierRequestSchema))
    createTierRequest: CreateTierRequest,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출
    const adminId = '550e8400-e29b-41d4-a716-446655440000';

    return this.adminOperationsService.createTier(createTierRequest, adminId);
  }

  /**
   * 티어 수정
   */
  @Put('tiers/:tierId')
  async updateTier(
    @Param('tierId') tierId: string,
    @Body(new ZodValidationPipe(UpdateTierRequestSchema))
    updateTierRequest: UpdateTierRequest,
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
  async createPlan(
    @Body(new ZodValidationPipe(CreatePlanRequestSchema))
    createPlanRequest: CreatePlanRequest,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출
    const adminId = '550e8400-e29b-41d4-a716-446655440000';

    return this.adminOperationsService.createPlan(createPlanRequest, adminId);
  }

  /**
   * 플랜 수정
   */
  @Put('plans/:planId')
  async updatePlan(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(UpdatePlanRequestSchema))
    updatePlanRequest: UpdatePlanRequest,
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
  async deactivatePlan(
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(DeactivatePlanRequestSchema))
    deactivatePlanRequest: DeactivatePlanRequest,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출
    const adminId = '550e8400-e29b-41d4-a716-446655440000';

    return this.adminOperationsService.deactivatePlan(
      planId,
      deactivatePlanRequest,
      adminId,
    );
  }

  // ===================================================================
  // 정책 관리 API
  // ===================================================================

  /**
   * 모든 정책을 조회합니다.
   */
  @Get('policies')
  async getAllPolicies(
    @Query() query: GetPoliciesQuery,
  ): Promise<PolicyListResponse> {
    return this.policyManagementService.getAllPolicies(query);
  }

  /**
   * 특정 정책을 조회합니다.
   */
  @Get('policies/:policyId')
  async getPolicyById(
    @Param('policyId') policyId: string,
  ): Promise<PolicyResponse | null> {
    return this.policyManagementService.getPolicyById(policyId);
  }

  /**
   * 새로운 정책을 생성합니다.
   */
  @Post('policies')
  @HttpCode(HttpStatus.CREATED)
  async createPolicy(
    @Body(new ZodValidationPipe(CreatePolicyRequestSchema))
    createPolicyDto: CreatePolicyRequest,
  ): Promise<PolicyResponse | null> {
    const result =
      await this.policyManagementService.createPolicy(createPolicyDto);

    // TODO: 정책 변경 이벤트 발행 (알림 서비스에 전달)
    // await this.eventPublisher.publish('policy.created', {
    //   policyId: result.id,
    //   affectedUsers: await this.getAffectedUsers(result)
    // });

    return result;
  }

  /**
   * 기존 정책을 업데이트합니다.
   */
  @Put('policies/:policyId')
  async updatePolicy(
    @Param('policyId') policyId: string,
    @Body(new ZodValidationPipe(UpdatePolicyRequestSchema))
    updatePolicyDto: UpdatePolicyRequest,
  ): Promise<PolicyResponse | null> {
    const result = await this.policyManagementService.updatePolicy(
      policyId,
      updatePolicyDto,
    );

    // TODO: 정책 변경 이벤트 발행 (알림 서비스에 전달)
    // await this.eventPublisher.publish('policy.updated', {
    //   policyId: result.id,
    //   changes: updatePolicyDto,
    //   affectedUsers: await this.getAffectedUsers(result)
    // });

    return result;
  }

  /**
   * 정책을 비활성화합니다.
   */
  @Delete('policies/:policyId')
  async deactivatePolicy(
    @Param('policyId') policyId: string,
  ): Promise<{ success: boolean; message: string } | null> {
    const result =
      await this.policyManagementService.deactivatePolicy(policyId);

    // TODO: 정책 비활성화 이벤트 발행
    // await this.eventPublisher.publish('policy.deactivated', {
    //   policyId,
    //   affectedUsers: await this.getAffectedUsers({ id: policyId })
    // });

    return result;
  }

  /**
   * 정책 적용 통계를 조회합니다.
   */
  @Get('policies/:policyId/statistics')
  getPolicyStatistics(
    @Param('policyId') policyId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    // TODO: 정책 적용 통계 구현
    return {
      policyId,
      period: { startDate, endDate },
      totalApplications: 0,
      successfulApplications: 0,
      violations: 0,
      message: '정책 통계 기능은 추후 구현 예정입니다.',
    };
  }

  /**
   * 정책 영향을 받는 사용자 목록을 조회합니다.
   */
  @Get('policies/:policyId/affected-users')
  getAffectedUsers(
    @Param('policyId') policyId: string,
    @Query('limit') limit: number = 100,
  ) {
    // TODO: 정책 영향 사용자 조회 구현
    return {
      policyId,
      affectedUserCount: 0,
      users: [],
      message: '정책 영향 사용자 조회 기능은 추후 구현 예정입니다.',
    };
  }

  // ===================================================================
  // 사용자 권한 관리 API (관리자용)
  // ===================================================================

  /**
   * 사용자 권한 연장
   */
  @Post('rights/extend/:userId')
  @HttpCode(HttpStatus.OK)
  extendUserRights(
    @Param('userId') userId: string,
    @Body()
    request: {
      additionalDays: number;
      reason: string;
    },
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인
    const adminId = '550e8400-e29b-41d4-a716-446655440000';

    // TODO: RightsService 주입 및 실제 구현
    // await this.rightsService.extendUserRights(
    //   userId,
    //   request.additionalDays,
    //   request.reason,
    // );

    return {
      success: true,
      message: `사용자 ${userId}의 권한이 ${request.additionalDays}일 연장되었습니다.`,
      extendedBy: adminId,
      extendedAt: new Date().toISOString(),
    };
  }

  /**
   * 사용자 권한 종료
   */
  @Post('rights/terminate/:userId')
  @HttpCode(HttpStatus.OK)
  terminateUserRights(
    @Param('userId') userId: string,
    @Body()
    request: {
      reason: string;
    },
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인
    const adminId = '550e8400-e29b-41d4-a716-446655440000';

    // TODO: RightsService 주입 및 실제 구현
    // await this.rightsService.terminateUserRights(userId, request.reason);

    return {
      success: true,
      message: `사용자 ${userId}의 권한이 종료되었습니다.`,
      terminatedBy: adminId,
      terminatedAt: new Date().toISOString(),
      reason: request.reason,
    };
  }

  /**
   * 사용자 권한 일시정지
   */
  @Post('rights/pause/:userId')
  @HttpCode(HttpStatus.OK)
  pauseUserRights(
    @Param('userId') userId: string,
    @Body()
    request: {
      pausedAt?: string;
    },
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인
    const adminId = '550e8400-e29b-41d4-a716-446655440000';
    const pausedAt = request.pausedAt ? new Date(request.pausedAt) : new Date();

    // TODO: RightsService 주입 및 실제 구현
    // await this.rightsService.pauseUserRights(userId, pausedAt);

    return {
      success: true,
      message: `사용자 ${userId}의 권한이 일시정지되었습니다.`,
      pausedBy: adminId,
      pausedAt: pausedAt.toISOString(),
    };
  }

  /**
   * 사용자 권한 재개
   */
  @Post('rights/resume/:userId')
  @HttpCode(HttpStatus.OK)
  resumeUserRights(
    @Param('userId') userId: string,
    @Body()
    request: {
      newEndsAt?: string;
    },
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인
    const adminId = '550e8400-e29b-41d4-a716-446655440000';
    const newEndsAt = request.newEndsAt
      ? new Date(request.newEndsAt)
      : undefined;

    // TODO: RightsService 주입 및 실제 구현
    // await this.rightsService.resumeUserRights(userId, newEndsAt);

    return {
      success: true,
      message: `사용자 ${userId}의 권한이 재개되었습니다.`,
      resumedBy: adminId,
      resumedAt: new Date().toISOString(),
      newEndsAt: newEndsAt?.toISOString(),
    };
  }

  /**
   * 사용자 권한 통계 조회
   */
  @Get('rights/statistics')
  getUserRightsStatistics() {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인
    const adminId = '550e8400-e29b-41d4-a716-446655440000';

    // TODO: 실제 통계 구현
    return {
      totalActiveUsers: 0,
      totalExpiredUsers: 0,
      totalPausedUsers: 0,
      message: '사용자 권한 통계 기능은 추후 구현 예정입니다.',
      requestedBy: adminId,
      requestedAt: new Date().toISOString(),
    };
  }
}
