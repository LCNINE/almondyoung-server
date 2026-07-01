import {
  Controller,
  Get,
  Post,
  Body,
  UseFilters,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiQuery, ApiBody } from '@nestjs/swagger';
// import { AuthGuard } from '@nestjs/passport'; // 실제 AuthGuard 대신 DevAuthGuard를 사용합니다.
import { SubscriptionService } from '../services/subscription.service';
import { SubscriptionCancellationService } from '../services/subscription-cancellation.service';
import { CancellationReasonReader } from '../services/subscription/cancellation-reason.reader';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import {
  CreateSubscriptionRequestSchema,
  CreateSubscriptionRequest,
  CreateCheckoutIntentRequestSchema,
  CreateCheckoutIntentRequest,
  ConfirmCheckoutIntentRequestSchema,
  ConfirmCheckoutIntentRequest,
  UpgradeSubscriptionRequestSchema,
  UpgradeSubscriptionRequest,
  DowngradeSubscriptionRequestSchema,
  DowngradeSubscriptionRequest,
  CancelSubscriptionRequestSchema,
  CancelSubscriptionRequest,
  SubscribeWithMethodRequestSchema,
  SubscribeWithMethodRequest,
} from '../shared/schemas';

import {
  SubscriptionDetailsResponseDto,
  SubscriptionHistoryResponseDto,
  ErrorResponseDto,
  CancellationResultDto,
  CancellationReasonsResponseDto,
} from '../shared/dto/response.dto';
import {
  CreateSubscriptionRequestDto,
  CreateCheckoutIntentRequestDto,
  ConfirmCheckoutIntentRequestDto,
  UpgradeSubscriptionRequestDto,
  DowngradeSubscriptionRequestDto,
  CancelSubscriptionRequestDto,
} from '../shared/dto/request.dto';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';
import { JwtAuthGuard, User } from '@app/authorization';
/**
 * 구독 관리 컨트롤러
 * 🚨 [주의] 현재 개발용 임시 인증 가드(DevAuthGuard)를 사용하고 있습니다.
 * 실제 프로덕션 배포 전 반드시 실제 인증 가드(AuthGuard('jwt'))로 교체해야 합니다.
 */
@ApiTags('subscriptions')
@Controller('subscriptions')
@UseFilters(SubscriptionExceptionFilter)
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly cancellationService: SubscriptionCancellationService,
    private readonly cancellationReasonReader: CancellationReasonReader,
  ) {}

  /**
   * 현재 구독 상태 조회
   *
   * @description 사용자의 현재 구독 상태를 조회합니다.
   */
  @Get('current')
  @ApiOperation({
    summary: '현재 구독 상태 조회',
    description: '사용자의 현재 활성 구독 정보를 플랜 및 티어 정보와 함께 조회합니다.',
  })
  @ApiQuery({
    name: 'userId',
    description: '사용자 ID (개발용)',
    required: false,
    example: 'test_user_001',
  })
  @ApiResponse({
    status: 200,
    description: '구독 상태 조회 성공',
    type: SubscriptionDetailsResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '활성 구독을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  async getCurrentSubscriptionDetails(@User('userId') userId: string) {
    return this.subscriptionService.getCurrentSubscriptionDetails(userId);
  }
  /**
   * 구독 생성
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '새 구독 생성',
    description: '지정된 플랜으로 새로운 구독을 생성합니다.',
  })
  @ApiQuery({
    name: 'userId',
    description: '사용자 ID (개발용)',
    required: false,
    example: 'test_user_001',
  })
  @ApiBody({ type: CreateSubscriptionRequestDto })
  @ApiResponse({
    status: 201,
    description: '구독 생성 성공',
    type: SubscriptionDetailsResponseDto,
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
  async createSubscription(
    @User() user: { userId: string; email?: string },
    @Body(new ZodValidationPipe(CreateSubscriptionRequestSchema))
    createSubscriptionDto: CreateSubscriptionRequest,
  ) {
    const userId = user?.userId;
    const email = user?.email;
    console.log('📥 구독 생성 요청:', {
      userId,
      planId: createSubscriptionDto.planId,
    });

    if (!userId) {
      throw new BadRequestException('userId가 필요합니다');
    }
    if (!email) {
      throw new BadRequestException('email이 필요합니다');
    }

    return this.subscriptionService.createSubscription(userId, createSubscriptionDto.planId, email);
  }

  @Post('checkout-intent')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '멤버십 최초 결제용 checkout intent 생성',
    description: '플랜 가격을 membership 서비스에서 검증한 뒤 wallet v1 payment-intent를 생성합니다.',
  })
  @ApiBody({ type: CreateCheckoutIntentRequestDto })
  @ApiResponse({
    status: 201,
    description: 'checkout intent 생성 성공',
    schema: {
      example: { intentId: '019d0005-1001-7000-a000-000000000001' },
    },
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
  async createCheckoutIntent(
    @User() user: { userId: string; email?: string },
    @Body(new ZodValidationPipe(CreateCheckoutIntentRequestSchema))
    dto: CreateCheckoutIntentRequest,
  ) {
    const userId = user?.userId;
    if (!userId) {
      throw new BadRequestException('userId가 필요합니다');
    }

    return this.subscriptionService.createCheckoutIntent(
      userId,
      dto.planId,
      dto.returnUrl,
      user?.email,
      dto.billingMode,
    );
  }

  /**
   * checkout-intent 결제 완료 후 구독 확정
   * JWT 불필요 - wallet API key로 payment intent를 검증하여 구독을 생성합니다.
   * (크로스도메인 결제 리다이렉트 후 accessToken 쿠키 소실 문제 우회)
   */
  @Post('confirm-checkout-intent')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '결제 완료 후 구독 확정',
    description: 'wallet payment intent를 검증하고 구독을 생성합니다. JWT 불필요 (API key 기반 검증).',
  })
  @ApiBody({ type: ConfirmCheckoutIntentRequestDto })
  @ApiResponse({
    status: 201,
    description: '구독 생성 성공',
    type: SubscriptionDetailsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '결제가 완료되지 않았거나 메타데이터 누락',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: '이미 활성 구독 존재 (성공으로 처리 가능)',
    type: ErrorResponseDto,
  })
  async confirmCheckoutIntent(
    @Body(new ZodValidationPipe(ConfirmCheckoutIntentRequestSchema))
    dto: ConfirmCheckoutIntentRequest,
  ) {
    return this.subscriptionService.confirmCheckoutIntent(dto.intentId);
  }

  /**
   * 구독 업그레이드
   */
  @Post('upgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '구독 업그레이드',
    description: '현재 구독을 더 높은 등급의 플랜으로 업그레이드합니다.',
  })
  @ApiSecurity('dev-user-id')
  @ApiBody({ type: UpgradeSubscriptionRequestDto })
  @ApiResponse({
    status: 200,
    description: '구독 업그레이드 성공',
    type: SubscriptionDetailsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '업그레이드 불가능한 플랜',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '활성 구독 또는 플랜을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @UseGuards(JwtAuthGuard) // 🚨 임시 가드 사용
  async upgradeSubscription(
    @User('userId') userId: string,
    @Body(new ZodValidationPipe(UpgradeSubscriptionRequestSchema))
    upgradeSubscriptionDto: UpgradeSubscriptionRequest,
  ) {
    return this.subscriptionService.upgradeSubscription(userId, upgradeSubscriptionDto.newPlanId);
  }

  /**
   * 구독 다운그레이드
   */
  @Post('downgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '구독 다운그레이드',
    description: '현재 구독을 더 낮은 등급의 플랜으로 다운그레이드합니다.',
  })
  @ApiSecurity('dev-user-id')
  @ApiBody({ type: DowngradeSubscriptionRequestDto })
  @ApiResponse({
    status: 200,
    description: '구독 다운그레이드 성공',
    type: SubscriptionDetailsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '다운그레이드 불가능한 플랜',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '활성 구독 또는 플랜을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @UseGuards(JwtAuthGuard) // 🚨 임시 가드 사용
  async downgradeSubscription(
    @User('userId') userId: string,
    @Body(new ZodValidationPipe(DowngradeSubscriptionRequestSchema))
    downgradeSubscriptionDto: DowngradeSubscriptionRequest,
  ) {
    return this.subscriptionService.downgradeSubscription(userId, downgradeSubscriptionDto.newPlanId);
  }

  /**
   * 구독 취소
   */
  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '구독 취소',
    description: '현재 활성 구독을 취소합니다.',
  })
  @ApiBody({ type: CancelSubscriptionRequestDto })
  @ApiResponse({
    status: 200,
    description: '구독 취소 성공',
    type: CancellationResultDto,
  })
  @ApiResponse({
    status: 404,
    description: '취소할 활성 구독을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @UseGuards(JwtAuthGuard) // 🚨 임시 가드 사용
  async cancelSubscription(
    @User() user: { userId: string; email?: string },
    @Body(new ZodValidationPipe(CancelSubscriptionRequestSchema))
    cancelSubscriptionDto: CancelSubscriptionRequest,
  ) {
    const userId = user?.userId;
    const email = user?.email;
    try {
      if (!userId) {
        throw new BadRequestException('userId가 필요합니다');
      }
      if (!email) {
        throw new BadRequestException('email이 필요합니다');
      }
      return await this.cancellationService.cancelSubscription(
        userId,
        email,
        cancelSubscriptionDto.reasonCode,
        cancelSubscriptionDto.reasonText,
      );
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) {
        throw new NotFoundException(e.message);
      }
      if (msg.includes('already cancelled')) {
        throw new BadRequestException(e.message);
      }
      throw new InternalServerErrorException(e.message);
    }
  }

  /**
   * 구독 이력 조회
   */
  @Get('history')
  @ApiOperation({
    summary: '구독 이력 조회',
    description: '사용자의 모든 구독 이력을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '구독 이력 조회 성공',
    type: SubscriptionHistoryResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '구독 이력을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @UseGuards(JwtAuthGuard) // 🚨 임시 가드 사용
  async getSubscriptionHistory(@User('userId') userId: string) {
    return this.subscriptionService.getSubscriptionHistory(userId);
  }

  /**
   * 기존 결제수단으로 즉시 구독
   */
  @Post('subscribe-with-method')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '기존 결제수단으로 구독',
    description: '이미 등록된 billing_method로 즉시 결제 후 구독을 생성합니다.',
  })
  @UseGuards(JwtAuthGuard)
  async subscribeWithMethod(
    @User() user: { userId: string; email?: string },
    @Body(new ZodValidationPipe(SubscribeWithMethodRequestSchema)) body: SubscribeWithMethodRequest,
  ) {
    const userId = user?.userId;
    const email = user?.email ?? '';
    if (!userId) throw new BadRequestException('userId가 필요합니다');
    // 도메인 예외(PlanNotFound 404 / ActiveSubscriptionExists 409 / SubscriptionBadRequest 400)는
    // 각자 올바른 상태코드를 갖고 있으므로 글로벌 필터에 위임한다. 문자열 매칭 재매핑은
    // '정기결제 설정에 실패' 같은 메시지를 500으로 떨어뜨려 원인 파악을 어렵게 했다.
    return this.subscriptionService.subscribeWithBillingMethod(
      userId,
      body.planId,
      email,
      body.billingMethodId,
      body.billingMode ?? 'one_time',
      body.checkoutAttemptId,
    );
  }

  /**
   * 취소 이유 목록 조회
   */
  @Get('cancellation-reasons')
  @ApiOperation({
    summary: '취소 이유 목록 조회',
    description: '활성화된 구독 취소 이유 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '취소 이유 목록 조회 성공',
    type: CancellationReasonsResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  async getCancellationReasons(@User('userId') userId: string) {
    const reasons = await this.cancellationReasonReader.findActiveReasons();
    return {
      reasons,
    };
  }
}
