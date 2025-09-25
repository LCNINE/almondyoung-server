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
import { AdminOperationsService } from '../services/admin-operations.service';
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
  private readonly logger = new Logger(AdminOperationsController.name);

  constructor(
    private readonly adminOperationsService: AdminOperationsService,
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
  // 정기결제 테스트 엔드포인트 (임시)
  // =================================================================

  @Post('billing/process-due')
  async processDueBillings() {
    try {
      this.logger.log('정기결제 처리 테스트 요청');

      // 임시로 간단한 응답 반환
      const result = {
        message: '정기결제 스케줄러는 매 5분마다 자동 실행됩니다',
        status: '스케줄러가 백그라운드에서 실행 중입니다',
        nextRun: '다음 5분 간격',
        testData:
          'quick-test-setup.sql을 실행하여 테스트 데이터를 준비해주세요',
      };

      this.logger.log('✅ 정기결제 처리 테스트 응답 반환');

      return {
        success: true,
        data: result,
        meta: {
          action: 'billing_process_test',
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.handleError(error, '정기결제 처리 테스트');
    }
  }
}
