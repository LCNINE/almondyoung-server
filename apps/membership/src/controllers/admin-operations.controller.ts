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
  HttpException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiSecurity,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AdminOperationsService } from '../services/admin-operations.service';
import { SubscriptionCancellationService } from '../services/subscription-cancellation.service';
import { ContractEventManager } from '../services/subscription/contract-event.manager';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';
import { DevAuthGuard } from '../auth/dev-auth.guard'; // 🚨 개발용 임시 가드
import {
  CreateTierRequest,
  UpdateTierRequest,
  CreatePlanRequest,
  UpdatePlanRequest,
  DeactivatePlanRequest,
  ExtendEntitlementRequest,
  CreateTierRequestSchema,
  UpdateTierRequestSchema,
  CreatePlanRequestSchema,
  UpdatePlanRequestSchema,
  DeactivatePlanRequestSchema,
  ExtendEntitlementRequestSchema,
  ForceCancelSubscriptionRequest,
  ForceCancelSubscriptionRequestSchema,
} from '../shared/schemas';

import {
  AdminTierResponseDto,
  AdminPlanResponseDto,
  AdminUserPauseHistoryResponseDto,
  AdminEntitlementResponseDto,
  AdminBillingTestResponseDto,
  ErrorResponseDto,
  CancellationResultDto,
  ContractEventsResponseDto,
} from '../shared/dto/response.dto';
import {
  CreateTierRequestDto,
  UpdateTierRequestDto,
  CreatePlanRequestDto,
  UpdatePlanRequestDto,
  DeactivatePlanRequestDto,
  ExtendEntitlementRequestDto,
  ForceCancelSubscriptionRequestDto,
} from '../shared/dto/request.dto';
import { FastifyRequest } from 'fastify';
/**
 * 관리자 운영 컨트롤러
 * 🚨 [주의] 현재 개발용 임시 인증 가드(DevAuthGuard)를 사용하고 있습니다.
 */
@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@ApiSecurity('dev-user-id')
@Controller('admin')
@UseGuards(DevAuthGuard) // 모든 API에 관리자 인증 가드 적용
@UseFilters(SubscriptionExceptionFilter)
export class AdminOperationsController {
  private readonly logger = new Logger(AdminOperationsController.name);

  constructor(
    private readonly adminOperationsService: AdminOperationsService,
    private readonly cancellationService: SubscriptionCancellationService,
    private readonly contractEventManager: ContractEventManager,
  ) {}

  /**
   * 공통 에러 처리 헬퍼 메서드
   */
  private handleError(error: any, operation: string, context?: string): never {
    const contextInfo = context ? ` (${context})` : '';
    this.logger.error(`❌ ${operation} 실패${contextInfo}:`, error.message);

    // CTO 스타일: 에러 메시지 패턴 기반 HTTP 응답 변환
    if (
      error.message.includes('not found') ||
      error.message.includes('찾을 수 없')
    ) {
      throw new HttpException(
        `요청한 리소스를 찾을 수 없습니다.`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (
      error.message.includes('already exists') ||
      error.message.includes('already') ||
      error.message.includes('invalid') ||
      error.message.includes('잘못된') ||
      error.message.includes('exceeds') ||
      error.message.includes('required')
    ) {
      throw new HttpException(
        `잘못된 요청입니다: ${error.message}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 기타 모든 오류는 500으로 처리
    throw new HttpException(
      `${operation} 중 오류가 발생했습니다.`,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // ===================================================================
  // Plan & Tier Management
  // ===================================================================

  @Post('tiers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '새 티어 생성',
    description: '새로운 구독 티어를 생성합니다.',
  })
  @ApiBody({ type: CreateTierRequestDto })
  @ApiResponse({
    status: 201,
    description: '티어 생성 성공',
    type: AdminTierResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터',
    type: ErrorResponseDto,
  })
  async createTier(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(CreateTierRequestSchema))
    dto: CreateTierRequest,
  ) {
    try {
      const adminId = req.user!.userId;
      this.logger.log(`티어 생성 요청: ${dto.code} (관리자: ${adminId})`);

      const result = await this.adminOperationsService.createTier(dto, adminId);

      this.logger.log(`✅ 티어 생성 성공: ${dto.code}`);

      return {
        success: true,
        data: result,
        meta: {
          action: 'create_tier',
          adminId,
          tierCode: dto.code,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.handleError(error, '티어 생성', dto.code);
    }
  }

  @Put('tiers/:tierId')
  @ApiOperation({
    summary: '티어 정보 수정',
    description: '기존 티어의 정보를 수정합니다.',
  })
  @ApiParam({
    name: 'tierId',
    description: '티어 UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({ type: UpdateTierRequestDto })
  @ApiResponse({
    status: 200,
    description: '티어 수정 성공',
    type: AdminTierResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '티어를 찾을 수 없음',
    type: ErrorResponseDto,
  })
  async updateTier(
    @Req() req: FastifyRequest,
    @Param('tierId') tierId: string,
    @Body(new ZodValidationPipe(UpdateTierRequestSchema))
    dto: UpdateTierRequest,
  ) {
    try {
      const adminId = req.user!.userId;
      this.logger.log(`티어 수정 요청: ${tierId} (관리자: ${adminId})`);

      const result = await this.adminOperationsService.updateTier(
        tierId,
        dto,
        adminId,
      );

      this.logger.log(`✅ 티어 수정 성공: ${tierId}`);

      return {
        success: true,
        data: result,
        meta: {
          action: 'update_tier',
          adminId,
          tierId,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.handleError(error, '티어 수정', tierId);
    }
  }

  @Post('plans')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '새 플랜 생성',
    description: '특정 티어에 새로운 구독 플랜을 생성합니다.',
  })
  @ApiBody({ type: CreatePlanRequestDto })
  @ApiResponse({
    status: 201,
    description: '플랜 생성 성공',
    type: AdminPlanResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '티어를 찾을 수 없음',
    type: ErrorResponseDto,
  })
  async createPlan(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(CreatePlanRequestSchema))
    dto: CreatePlanRequest,
  ) {
    try {
      const adminId = req.user!.userId;
      this.logger.log(
        `플랜 생성 요청: 티어 ${dto.tierId} (관리자: ${adminId})`,
      );

      const result = await this.adminOperationsService.createPlan(dto, adminId);

      this.logger.log(`✅ 플랜 생성 성공: ${result.planId}`);

      return {
        success: true,
        data: result,
        meta: {
          action: 'create_plan',
          adminId,
          tierId: dto.tierId,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.handleError(error, '플랜 생성', `티어: ${dto.tierId}`);
    }
  }

  @Put('plans/:planId')
  @ApiOperation({
    summary: '플랜 정보 수정',
    description: '기존 플랜의 정보를 수정합니다.',
  })
  @ApiParam({
    name: 'planId',
    description: '플랜 UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({ type: UpdatePlanRequestDto })
  @ApiResponse({
    status: 200,
    description: '플랜 수정 성공',
    type: AdminPlanResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '플랜을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  async updatePlan(
    @Req() req: FastifyRequest,
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(UpdatePlanRequestSchema))
    dto: UpdatePlanRequest,
  ) {
    try {
      const adminId = req.user!.userId;
      this.logger.log(`플랜 수정 요청: ${planId} (관리자: ${adminId})`);

      const result = await this.adminOperationsService.updatePlan(
        planId,
        dto,
        adminId,
      );

      this.logger.log(`✅ 플랜 수정 성공: ${planId}`);

      return {
        success: true,
        data: result,
        meta: {
          action: 'update_plan',
          adminId,
          planId,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.handleError(error, '플랜 수정', planId);
    }
  }

  @Delete('plans/:planId')
  @ApiOperation({
    summary: '플랜 비활성화',
    description: '기존 플랜을 비활성화합니다.',
  })
  @ApiParam({
    name: 'planId',
    description: '플랜 UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({ type: DeactivatePlanRequestDto })
  @ApiResponse({
    status: 200,
    description: '플랜 비활성화 성공',
    type: AdminPlanResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '플랜을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  async deactivatePlan(
    @Req() req: FastifyRequest,
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(DeactivatePlanRequestSchema))
    dto: DeactivatePlanRequest,
  ) {
    try {
      const adminId = req.user!.userId;
      this.logger.log(`플랜 비활성화 요청: ${planId} (관리자: ${adminId})`);

      const result = await this.adminOperationsService.deactivatePlan(
        planId,
        dto,
        adminId,
      );

      this.logger.log(`✅ 플랜 비활성화 성공: ${planId}`);

      return {
        success: true,
        data: result,
        meta: {
          action: 'deactivate_plan',
          adminId,
          planId,
          reason: dto.reason,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.handleError(error, '플랜 비활성화', planId);
    }
  }

  // ===================================================================
  // Entitlement Management - 구독 권한 관리
  // ===================================================================

  @Post('entitlements/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '사용자 구독 기간 조정',
    description: '사용자의 구독 기간을 연장하거나 단축합니다.',
  })
  @ApiBody({ type: ExtendEntitlementRequestDto })
  @ApiResponse({
    status: 200,
    description: '구독 기간 조정 성공',
    type: AdminEntitlementResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '사용자 구독을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  async adjustUserEntitlement(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(ExtendEntitlementRequestSchema))
    dto: ExtendEntitlementRequest,
  ) {
    try {
      const adminId = req.user!.userId;
      this.logger.log(
        `구독 기간 조정 요청: ${dto.userId} (${dto.days}일, 관리자: ${adminId})`,
      );

      const result = await this.adminOperationsService.adjustUserEntitlement(
        dto,
        adminId,
      );

      this.logger.log(`✅ 구독 기간 조정 성공: ${dto.userId}`);

      return {
        success: true,
        data: result,
        meta: {
          action: 'adjust_entitlement',
          adminId,
          userId: dto.userId,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.handleError(error, '구독 기간 조정', dto.userId);
    }
  }

  @Get('users/:userId/pause-history')
  @ApiOperation({
    summary: '사용자 일시정지 이력 조회',
    description: '특정 사용자의 모든 일시정지 이력을 조회합니다.',
  })
  @ApiParam({
    name: 'userId',
    description: '사용자 UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: '일시정지 이력 조회 성공',
    type: AdminUserPauseHistoryResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '사용자를 찾을 수 없음',
    type: ErrorResponseDto,
  })
  async getUserPauseHistory(@Param('userId') userId: string) {
    try {
      this.logger.log(`사용자 일시정지 이력 조회 요청: ${userId}`);

      const pauseHistory =
        await this.adminOperationsService.getUserPauseHistory(userId);

      this.logger.log(
        `✅ 사용자 일시정지 이력 조회 성공: ${userId} → ${pauseHistory.length}건`,
      );

      return {
        success: true,
        data: {
          userId,
          pauseHistory,
          totalPauses: pauseHistory.length,
        },
        meta: {
          action: 'get_user_pause_history',
          userId,
          retrievedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.handleError(error, '사용자 일시정지 이력 조회', userId);
    }
  }

  // =================================================================
  // 정기결제 테스트 엔드포인트 (임시) - 중복 경로로 인해 주석처리됨
  // 실제 정기결제 처리는 BillingController의 /api/admin/billing/process-due 사용
  // =================================================================

  // @Post('billing/process-due')
  // @ApiOperation({
  //   summary: '정기결제 처리 테스트',
  //   description: '정기결제 스케줄러 상태를 확인합니다. (개발용)'
  // })
  // @ApiResponse({
  //   status: 200,
  //   description: '정기결제 처리 테스트 성공',
  //   type: AdminBillingTestResponseDto
  // })
  // async processDueBillings() {
  //   try {
  //     this.logger.log('정기결제 처리 테스트 요청');

  //     // 임시로 간단한 응답 반환
  //     const result = {
  //       message: '정기결제 스케줄러는 매 5분마다 자동 실행됩니다',
  //       status: '스케줄러가 백그라운드에서 실행 중입니다',
  //       nextRun: '다음 5분 간격',
  //       testData:
  //         'quick-test-setup.sql을 실행하여 테스트 데이터를 준비해주세요',
  //     };

  //     this.logger.log('✅ 정기결제 처리 테스트 응답 반환');

  //     return {
  //       success: true,
  //       data: result,
  //       meta: {
  //         action: 'billing_process_test',
  //         processedAt: new Date().toISOString(),
  //       },
  //     };
  //   } catch (error) {
  //     this.handleError(error, '정기결제 처리 테스트');
  //   }
  // }

  // =================================================================
  // 구독 취소 관리 (Admin)
  // =================================================================

  /**
   * 계약 이벤트 이력 조회
   */
  @Get('subscriptions/:contractId/events')
  @ApiOperation({
    summary: '계약 이벤트 이력 조회',
    description: '특정 구독 계약의 모든 이벤트 이력을 조회합니다.',
  })
  @ApiParam({
    name: 'contractId',
    description: '구독 계약 ID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: '이벤트 이력 조회 성공',
    type: ContractEventsResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '계약을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  async getContractEvents(@Param('contractId') contractId: string) {
    try {
      this.logger.log(`계약 이벤트 이력 조회 - contractId: ${contractId}`);

      const events =
        await this.contractEventManager.getContractEvents(contractId);

      this.logger.log(
        `✅ 계약 이벤트 이력 조회 성공 - contractId: ${contractId}, events: ${events.length}`,
      );

      return {
        contractId,
        events,
      };
    } catch (error) {
      this.handleError(error, '계약 이벤트 이력 조회');
    }
  }

  /**
   * 강제 구독 취소
   */
  @Post('subscriptions/:contractId/force-cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '강제 구독 취소 (어드민)',
    description:
      '정책을 무시하고 구독을 강제로 취소합니다. 환불 금액을 직접 지정할 수 있습니다.',
  })
  @ApiParam({
    name: 'contractId',
    description: '구독 계약 ID',
    type: 'string',
  })
  @ApiBody({ type: ForceCancelSubscriptionRequestDto })
  @ApiResponse({
    status: 200,
    description: '강제 취소 성공',
    type: CancellationResultDto,
  })
  @ApiResponse({
    status: 404,
    description: '계약을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청',
    type: ErrorResponseDto,
  })
  async forceCancelSubscription(
    @Param('contractId') contractId: string,
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(ForceCancelSubscriptionRequestSchema))
    dto: ForceCancelSubscriptionRequest,
  ) {
    try {
      const adminId = req.user?.userId || 'admin';

      this.logger.log(
        `강제 구독 취소 요청 - contractId: ${contractId}, adminId: ${adminId}, refundType: ${dto.refundType}`,
      );

      const result = await this.cancellationService.forceCancelSubscription(
        contractId,
        adminId,
        dto.reason,
        dto.refundType,
        dto.refundAmount,
        dto.adminNote,
      );

      this.logger.log(`✅ 강제 구독 취소 성공 - contractId: ${contractId}`);

      return result;
    } catch (error) {
      this.handleError(error, '강제 구독 취소');
    }
  }
}
