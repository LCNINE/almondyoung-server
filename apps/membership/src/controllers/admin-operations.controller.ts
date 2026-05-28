import {
  Controller,
  Post,
  Put,
  Patch,
  Delete,
  Get,
  Body,
  Param,
  Query,
  UseFilters,
  HttpStatus,
  HttpCode,
  UseGuards,
  HttpException,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { AdminOperationsService } from '../services/admin-operations.service';
import { AdminMembersReader } from '../services/admin/admin-members.reader';
import { SubscriptionCancellationService } from '../services/subscription-cancellation.service';
import { ContractEventManager } from '../services/subscription/contract-event.manager';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';
import { CreatePlanRequest, CreatePlanRequestSchema } from '../shared/schemas';

import {
  AdminTierResponseDto,
  AdminPlanResponseDto,
  AdminUserPauseHistoryResponseDto,
  AdminEntitlementResponseDto,
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
  GetBulkSubscriptionsRequestDto,
  AdminSubscribeUserRequestDto,
} from '../shared/dto/request.dto';
import { JwtAuthGuard, User } from '@app/authorization';
import { SubscriptionService } from '../services/subscription.service';
/**
 * 관리자 운영 컨트롤러
 * 🚨 [주의] 현재 개발용 임시 인증 가드(DevAuthGuard)를 사용하고 있습니다.
 */
@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard) // 모든 API에 관리자 인증 가드 적용
@UseFilters(SubscriptionExceptionFilter)
export class AdminOperationsController {
  private readonly logger = new Logger(AdminOperationsController.name);

  constructor(
    private readonly adminOperationsService: AdminOperationsService,
    private readonly subscriptionService: SubscriptionService,
    private readonly cancellationService: SubscriptionCancellationService,
    private readonly contractEventManager: ContractEventManager,
    private readonly adminMembersReader: AdminMembersReader,
  ) {}

  private handleError(error: unknown, operation: string, context?: string): never {
    const msg = error instanceof Error ? error.message : String(error);
    const contextInfo = context ? ` (${context})` : '';
    this.logger.error(`❌ ${operation} 실패${contextInfo}:`, msg);

    if (msg.includes('not found') || msg.includes('찾을 수 없')) {
      throw new HttpException(`요청한 리소스를 찾을 수 없습니다.`, HttpStatus.NOT_FOUND);
    }

    if (
      msg.includes('already exists') ||
      msg.includes('already') ||
      msg.includes('invalid') ||
      msg.includes('잘못된') ||
      msg.includes('exceeds') ||
      msg.includes('required')
    ) {
      throw new HttpException(`잘못된 요청입니다: ${msg}`, HttpStatus.BAD_REQUEST);
    }

    throw new HttpException(`${operation} 중 오류가 발생했습니다.`, HttpStatus.INTERNAL_SERVER_ERROR);
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
  @UseGuards(JwtAuthGuard)
  async createTier(@User('userId') userId: string, @Body() dto: CreateTierRequestDto) {
    try {
      const adminId = userId;
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
  @UseGuards(JwtAuthGuard)
  async updateTier(@User('userId') userId: string, @Param('tierId') tierId: string, @Body() dto: UpdateTierRequestDto) {
    try {
      const adminId = userId;
      this.logger.log(`티어 수정 요청: ${tierId} (관리자: ${adminId})`);

      const result = await this.adminOperationsService.updateTier(tierId, dto, adminId);

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
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  async createPlan(
    @User('userId') userId: string,
    @Body(new ZodValidationPipe(CreatePlanRequestSchema))
    dto: CreatePlanRequest,
  ) {
    try {
      const adminId = userId;
      this.logger.log(`플랜 생성 요청: 티어 ${dto.tierId} (관리자: ${adminId})`);

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
  @UseGuards(JwtAuthGuard)
  async updatePlan(@User('userId') userId: string, @Param('planId') planId: string, @Body() dto: UpdatePlanRequestDto) {
    try {
      const adminId = userId;
      this.logger.log(`플랜 수정 요청: ${planId} (관리자: ${adminId})`);

      const result = await this.adminOperationsService.updatePlan(planId, dto, adminId);

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
  @UseGuards(JwtAuthGuard)
  async deactivatePlan(
    @User('userId') userId: string,
    @Param('planId') planId: string,
    @Body() dto: DeactivatePlanRequestDto,
  ) {
    try {
      const adminId = userId;
      this.logger.log(`플랜 비활성화 요청: ${planId} (관리자: ${adminId})`);

      const result = await this.adminOperationsService.deactivatePlan(planId, dto, adminId);

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

  @Get('tiers')
  @ApiOperation({ summary: '티어 + 플랜 전체 조회 (관리자용)' })
  @UseGuards(JwtAuthGuard)
  async getAllTiersWithPlans() {
    try {
      const result = await this.adminOperationsService.getAllTiersWithPlans();
      return { success: true, data: result };
    } catch (error) {
      this.handleError(error, '티어 목록 조회');
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
  @UseGuards(JwtAuthGuard)
  async adjustUserEntitlement(@User('userId') userId: string, @Body() dto: ExtendEntitlementRequestDto) {
    try {
      const adminId = userId;
      this.logger.log(`구독 기간 조정 요청: ${dto.userId} (${dto.days}일, 관리자: ${adminId})`);

      const result = await this.adminOperationsService.adjustUserEntitlement(dto, adminId);

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

      const pauseHistory = await this.adminOperationsService.getUserPauseHistory(userId);

      this.logger.log(`✅ 사용자 일시정지 이력 조회 성공: ${userId} → ${pauseHistory.length}건`);

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
  @UseGuards(JwtAuthGuard)
  async getContractEvents(@Param('contractId') contractId: string) {
    try {
      this.logger.log(`계약 이벤트 이력 조회 - contractId: ${contractId}`);

      const events = await this.contractEventManager.getContractEvents(contractId);

      this.logger.log(`✅ 계약 이벤트 이력 조회 성공 - contractId: ${contractId}, events: ${events.length}`);

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
    description: '정책을 무시하고 구독을 강제로 취소합니다. 환불 금액을 직접 지정할 수 있습니다.',
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
  @UseGuards(JwtAuthGuard)
  async forceCancelSubscription(
    @User('userId') userId: string,
    @Param('contractId') contractId: string,
    @Body() dto: ForceCancelSubscriptionRequestDto,
  ) {
    try {
      const adminId = userId;

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

  /**
   * 여러 사용자의 멤버십 정보 일괄 조회
   *
   * POST /subscriptions/bulk
   * Body: { id: ["user_123", "user_456", ...] }
   *
   * Response: [
   *   { id: "user_123", membership: {...} },
   *   { id: "user_456", membership: null }
   * ]
   */
  @Post('subscriptions/bulk')
  async getBulkMemberships(@Body() dto: GetBulkSubscriptionsRequestDto) {
    try {
      const result = await this.subscriptionService.getBulkSubscriptions(dto.id);
      return result;
    } catch (error) {
      this.handleError(error, '여러 사용자의 구독 정보 일괄 조회');
    }
  }

  @Patch('plans/:planId/activate')
  @ApiOperation({ summary: '플랜 활성화 복구' })
  @UseGuards(JwtAuthGuard)
  async activatePlan(@User('userId') adminId: string, @Param('planId') planId: string) {
    try {
      const result = await this.adminOperationsService.activatePlan(planId, adminId);
      return { success: true, data: result };
    } catch (error) {
      this.handleError(error, '플랜 활성화', planId);
    }
  }

  @Post('members/subscribe')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '관리자 신규 회원 구독 등록' })
  @ApiBody({ type: AdminSubscribeUserRequestDto })
  @UseGuards(JwtAuthGuard)
  async adminSubscribeUser(@User('userId') adminId: string, @Body() dto: AdminSubscribeUserRequestDto) {
    try {
      const result = await this.adminOperationsService.adminSubscribeUser(dto.userId, dto.planId, dto.billingMode);
      return { success: true, data: result };
    } catch (error) {
      this.handleError(error, '신규 회원 구독 등록', dto.userId);
    }
  }

  @Post('members/:userId/grant')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '관리자 직접 구독 지급 (일수 + 메모)' })
  @UseGuards(JwtAuthGuard)
  async grantSubscriptionByDays(
    @User('userId') adminId: string,
    @Param('userId') userId: string,
    @Body() body: { days: number; memo?: string },
  ) {
    const days = Number(body.days);
    if (!days || days < 1) throw new BadRequestException('days는 1 이상이어야 합니다.');
    try {
      const result = await this.adminOperationsService.adminGrantSubscriptionByDays(
        userId,
        days,
        body.memo ?? null,
        adminId,
      );
      return { success: true, data: result };
    } catch (error) {
      this.handleError(error, '구독 지급', userId);
    }
  }

  @Post('billing/retry/:contractId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '결제 수동 재시도' })
  @UseGuards(JwtAuthGuard)
  async retryBilling(@User('userId') adminId: string, @Param('contractId') contractId: string) {
    try {
      const result = await this.adminOperationsService.retryBillingForContract(contractId);
      return { success: true, data: result };
    } catch (error) {
      this.handleError(error, '결제 재시도', contractId);
    }
  }

  /**
   * 멤버십 회원 목록 조회 (관리자 어드민용)
   *
   * GET /admin/members?page=1&limit=20&status=ACTIVE&q=userId&dateFrom=&dateTo=
   */
  @Get('members')
  @ApiOperation({
    summary: '멤버십 회원 목록 조회',
    description: '멤버십을 한 번이라도 구독했던 회원 목록을 페이지네이션 및 필터와 함께 조회합니다.',
  })
  @UseGuards(JwtAuthGuard)
  async getMembersList(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('userIds') userIds?: string | string[],
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('dateCriteria') dateCriteria?: 'createdAt' | 'cancelledAt',
  ) {
    try {
      const normalizedUserIds = userIds ? (Array.isArray(userIds) ? userIds : [userIds]) : undefined;
      const result = await this.adminOperationsService.getMembersList({
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
        status: status as 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED' | undefined,
        q,
        userIds: normalizedUserIds,
        dateFrom,
        dateTo,
        dateCriteria,
      });
      return result;
    } catch (error) {
      this.handleError(error, '멤버십 회원 목록 조회');
    }
  }

  /**
   * 멤버십 회원 상세 조회
   *
   * GET /admin/members/:userId
   */
  @Get('members/:userId')
  @ApiOperation({ summary: '멤버십 회원 상세 조회' })
  @UseGuards(JwtAuthGuard)
  async getMemberDetail(@Param('userId') userId: string) {
    try {
      const result = await this.adminOperationsService.getMemberDetail(userId);
      if (!result) {
        throw new NotFoundException(`멤버십 회원을 찾을 수 없습니다: ${userId}`);
      }
      return { success: true, data: result };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.handleError(error, '멤버십 회원 상세 조회', userId);
    }
  }

  /**
   * 멤버십 결제 이벤트 조회
   *
   * GET /admin/billing-events?userId=xxx (또는 contractId=xxx for legacy)
   */
  @Get('billing-events')
  @ApiOperation({ summary: '멤버십 결제 이벤트 조회' })
  @UseGuards(JwtAuthGuard)
  async getMemberBillingEvents(@Query('userId') userId?: string, @Query('contractId') contractId?: string) {
    if (!userId && !contractId) throw new BadRequestException('userId or contractId is required');
    try {
      if (userId) {
        const result = await this.adminOperationsService.getMemberBillingEventsByUserId(userId);
        return { success: true, data: result };
      }
      const result = await this.adminOperationsService.getMemberBillingEvents(contractId!);
      return { success: true, data: result };
    } catch (error) {
      this.handleError(error, '멤버십 결제 이벤트 조회', userId ?? contractId);
    }
  }

  /**
   * 멤버십 계약 이벤트(로그) 조회
   *
   * GET /admin/contract-events?userId=xxx (또는 contractId=xxx for legacy)
   */
  @Get('contract-events')
  @ApiOperation({ summary: '멤버십 계약 이벤트 로그 조회' })
  @UseGuards(JwtAuthGuard)
  async getMemberContractEvents(@Query('userId') userId?: string, @Query('contractId') contractId?: string) {
    if (!userId && !contractId) throw new BadRequestException('userId or contractId is required');
    try {
      if (userId) {
        const result = await this.adminOperationsService.getMemberContractEventsByUserId(userId);
        return { success: true, data: result };
      }
      const result = await this.adminOperationsService.getMemberContractEvents(contractId!);
      return { success: true, data: result };
    } catch (error) {
      this.handleError(error, '멤버십 계약 이벤트 로그 조회', userId ?? contractId);
    }
  }

  /**
   * 정기결제 내역 전체 조회
   *
   * GET /admin/billing-history?page=1&limit=20&dateFrom=&dateTo=&contractId=&userId=&eventType=
   */
  @Get('billing-history')
  @ApiOperation({ summary: '정기결제 내역 전체 조회' })
  @UseGuards(JwtAuthGuard)
  async getAllBillingHistory(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('contractId') contractId?: string,
    @Query('userId') userId?: string,
    @Query('eventType') eventType?: string,
  ) {
    try {
      const result = await this.adminOperationsService.getAllBillingHistory({
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
        dateFrom,
        dateTo,
        contractId,
        userId,
        eventType,
      });
      return result;
    } catch (error) {
      this.handleError(error, '정기결제 내역 조회');
    }
  }

  /**
   * 자동 연장 설정 변경
   *
   * PUT /admin/contracts/:contractId/auto-renewal
   */
  @Put('contracts/:contractId/auto-renewal')
  @ApiOperation({ summary: '자동 연장 설정 변경' })
  @UseGuards(JwtAuthGuard)
  async setAutoRenewal(
    @User('userId') adminId: string,
    @Param('contractId') contractId: string,
    @Body('autoRenewal') autoRenewal: boolean,
  ) {
    try {
      await this.adminOperationsService.setAutoRenewal(contractId, autoRenewal, adminId);
      return { success: true, data: { contractId, autoRenewal } };
    } catch (error) {
      this.handleError(error, '자동 연장 설정 변경', contractId);
    }
  }

  /**
   * 정기결제(autoRenewal=true) 계약 목록 조회
   *
   * GET /admin/recurring-contracts?page=1&limit=20&userId=xxx&contractId=xxx&status=ACTIVE
   */
  @Get('recurring-contracts')
  @ApiOperation({ summary: '정기결제 계약 목록 조회 (autoRenewal=true)' })
  @UseGuards(JwtAuthGuard)
  async getRecurringContracts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('contractId') contractId?: string,
    @Query('status') status?: string,
    @Query('dateType') dateType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    try {
      return await this.adminMembersReader.findRecurringContracts({
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
        userId,
        contractId,
        status,
        dateType: dateType === 'createdAt' || dateType === 'nextBillingDate' ? dateType : 'updatedAt',
        dateFrom,
        dateTo,
      });
    } catch (error) {
      this.handleError(error, '정기결제 계약 목록 조회');
    }
  }

  /**
   * 정기결제 계약 ID 목록으로 계약 요약 일괄 조회
   *
   * GET /admin/recurring-contracts/by-ids?contractId=xxx&contractId=yyy
   */
  @Get('recurring-contracts/by-ids')
  @ApiOperation({ summary: '정기결제 계약 요약 일괄 조회 (by contractId[])' })
  @UseGuards(JwtAuthGuard)
  async getRecurringContractsByIds(@Query('contractId') contractIds: string | string[] | undefined) {
    const ids = contractIds ? (Array.isArray(contractIds) ? contractIds : [contractIds]) : [];
    if (!ids.length) return [];
    try {
      return await this.adminMembersReader.findRecurringContractsByIds(ids);
    } catch (error) {
      this.handleError(error, '정기결제 계약 요약 조회');
    }
  }

  /**
   * billingInProgress=true가 thresholdHours 이상 지속 중인 계약 목록.
   * wallet 결과 이벤트가 오지 않아 플래그가 고착된 계약을 관리자가 확인.
   *
   * GET /admin/stuck-billing-contracts?thresholdHours=48
   */
  @Get('stuck-billing-contracts')
  @ApiOperation({ summary: '결제 대기 장기화 계약 목록 (billingInProgress 고착)' })
  @UseGuards(JwtAuthGuard)
  async getStuckBillingContracts(@Query('thresholdHours') thresholdHours?: string) {
    try {
      const parsed = thresholdHours ? Number(thresholdHours) : NaN;
      const hours = Number.isFinite(parsed) ? Math.max(1, parsed) : 48;
      return await this.adminMembersReader.findStuckBillingContracts(hours);
    } catch (error) {
      this.handleError(error, '결제 대기 장기화 계약 조회');
    }
  }

  /**
   * 관리자 수동 조작: billingInProgress 플래그 해제.
   * wallet 결과 이벤트가 영구적으로 오지 않는 경우 사용.
   * 감사 이벤트(BILLING_PROGRESS_RESET_BY_ADMIN)를 남기고 reason 필수.
   *
   * POST /admin/contracts/:contractId/reset-billing-progress
   */
  @Post('contracts/:contractId/reset-billing-progress')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '결제 대기 플래그 수동 해제 (billingInProgress=false)' })
  @UseGuards(JwtAuthGuard)
  async resetBillingInProgress(
    @Param('contractId') contractId: string,
    @Body('reason') reason: string,
    @User('userId') adminId: string,
  ) {
    if (!contractId) throw new BadRequestException('contractId is required');
    if (!reason?.trim()) throw new BadRequestException('reason is required');
    try {
      return await this.adminMembersReader.resetBillingInProgress(contractId, adminId, reason.trim());
    } catch (error) {
      this.handleError(error, '결제 대기 플래그 해제');
    }
  }
}
