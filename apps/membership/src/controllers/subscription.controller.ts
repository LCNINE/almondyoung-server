import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseFilters,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody } from '@nestjs/swagger';
import { SubscriptionService } from '../services/subscription.service';
import { SubscriptionCancellationService } from '../services/subscription-cancellation.service';
import { CancellationReasonReader } from '../services/subscription/cancellation-reason.reader';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import {
  CreateCheckoutIntentRequestSchema,
  CreateCheckoutIntentRequest,
  ConfirmCheckoutIntentRequestSchema,
  ConfirmCheckoutIntentRequest,
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
  CreateCheckoutIntentRequestDto,
  ConfirmCheckoutIntentRequestDto,
  CancelSubscriptionRequestDto,
} from '../shared/dto/request.dto';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';
import { JwtAuthGuard, User } from '@app/authorization';
/**
 * 구독 관리 컨트롤러
 * 인증: JwtAuthGuard(= AuthGuard('jwt')) 적용. @Public()/@OptionalAuth() 로 우회.
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
  // 구독 생성은 결제 확인을 거친 경로(checkout-intent → confirm-checkout-intent, subscribe-with-method)로만
  // 이뤄진다. 결제 없이 계약/권한을 발급하던 `POST /subscriptions` 직접 경로는 무료 멤버십 발급 취약점이라 제거했다.

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

  // 플랜 변경(업그레이드/다운그레이드)은 비례정산·결제가 필요하다. 결제 없이 새 기간을 발급하던
  // `POST /upgrade`·`POST /downgrade` 직접 경로는 무료 상위티어 발급 취약점이라 제거했다.
  // 유료 플랜 변경은 결제 경로 위에서 별도로 구현한다(subscriptionManager 메서드는 그때 재사용).

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
        cancelSubscriptionDto.refundReceiveAccount,
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
   * 구독 이력 조회 (페이지네이션)
   *
   * ⚠️ 반드시 wildcard/파라미터 라우트보다 먼저 선언되어야 합니다.
   */
  @Get('history/paged')
  @ApiOperation({
    summary: '구독 이력 페이지네이션 조회',
    description: '사용자의 구독 이력을 limit/offset 기반으로 페이지네이션하여 조회합니다.',
  })
  @ApiQuery({ name: 'limit', description: '페이지 크기 (기본 10, 1~50)', required: false, example: 10 })
  @ApiQuery({ name: 'offset', description: '건너뛸 개수 (기본 0, 최소 0)', required: false, example: 0 })
  @ApiResponse({
    status: 200,
    description: '구독 이력 조회 성공',
  })
  @UseGuards(JwtAuthGuard)
  async getSubscriptionHistoryPaged(
    @User('userId') userId: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const parsedLimit = Number(limitRaw);
    const limit = Number.isNaN(parsedLimit) ? 10 : Math.min(50, Math.max(1, Math.trunc(parsedLimit)));

    const parsedOffset = Number(offsetRaw);
    const offset = Number.isNaN(parsedOffset) ? 0 : Math.max(0, Math.trunc(parsedOffset));

    return this.subscriptionService.getSubscriptionHistoryPaged(userId, limit, offset);
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
