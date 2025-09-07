import {
  Controller,
  Post,
  Body,
  HttpStatus,
  HttpException,
  Logger,
  Patch,
  Param,
  Headers,
  Get,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiInternalServerErrorResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { PaymentService } from '../services/payment.service';
import { PaymentMethodService } from '../services/payment-method.service';
import { PaymentSessionService } from '../services/payment-session.service';
import { RefundService } from '../services/refund.service';
import {
  PaymentRequestDto,
  RefundRequestDto,
  PaymentMethodRequestDto,
  PaymentResponseDto,
  RefundResponseDto,
  PaymentMethodResponseDto,
} from '../shared/dtos';

/**
 * 통합 결제 컨트롤러 (가이드 문서 준수)
 *
 * 6개 Flow 구현:
 * 1. 일반 결제: PaymentController.process()
 * 2. 정기 결제: PaymentController.processRecurring()
 * 3. 멤버십 결제: PaymentController.processMembership()
 * 4. BNPL 배치: PaymentController.captureBnplBatch()
 * 5. 환불: PaymentController.refund()
 * 6. 결제수단 등록: PaymentController.registerMethod()
 */
@ApiTags('결제 통합 API')
@Controller('payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly paymentMethodService: PaymentMethodService,
    private readonly paymentSessionService: PaymentSessionService,
    private readonly refundService: RefundService,
  ) {}

  /**
   * 서비스에서 던진 Error를 HTTP 상태코드로 매핑 (CTO 규칙)
   */
  private mapErrorToHttpException(error: Error): HttpException {
    const message = error.message.toLowerCase();

    if (message.includes('not found') || message.includes('찾을 수 없습니다')) {
      return new HttpException(error.message, HttpStatus.NOT_FOUND);
    }

    if (
      message.includes('already processed') ||
      message.includes('exceeds') ||
      message.includes('초과합니다') ||
      message.includes('required') ||
      message.includes('invalid') ||
      message.includes('failed') ||
      message.includes('실패') ||
      message.includes('유효하지')
    ) {
      return new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }

    return new HttpException(
      '서버 내부 오류가 발생했습니다',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // -------------------------------
  // Flow 1: 일반 결제
  // -------------------------------
  @Post('process')
  @ApiOperation({
    summary: '일반 결제 실행',
    description: `
일반 결제를 처리합니다:
- 카드: authorize + capture → CAPTURED  
- BNPL: authorize만 → AUTHORIZED (추후 capture 필요)  
- 포인트: 즉시 차감 → CAPTURED  

**멱등성 지원**: 동일한 Idempotency-Key로 재요청 시 동일한 결과 반환
    `,
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '멱등성 키 (선택사항)',
    required: false,
  })
  @ApiResponse({ status: 200, description: '결제 성공' })
  @ApiBadRequestResponse({ description: '잘못된 요청' })
  @ApiNotFoundResponse({ description: '결제수단을 찾을 수 없음' })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async process(
    @Body() dto: PaymentRequestDto,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ): Promise<PaymentResponseDto> {
    try {
      this.logger.log(
        `일반 결제 실행: ${dto.paymentMethodId}, ${dto.amount}원`,
      );

      const result = await this.paymentService.processPayment(
        {
          userId: dto.userId,
          paymentMethodId: dto.paymentMethodId,
          amount: dto.amount,
          currency: dto.currency || 'KRW',
          sessionId: dto.sessionId,
          metadata: dto.metadata,
          pricingSnapshot: dto.pricingSnapshot,
          actor: 'USER',
        },
        idempotencyKey,
      );

      return {
        paymentEventId: result.paymentEventId,
        sessionId: result.sessionId, // 세션 ID 필수 반환
        pgTransactionId: 'N/A', // 새 스키마에서는 event_context에 포함
        status: result.status,
        amount: result.amount,
        currency: dto.currency || 'KRW',
        createdAt: result.createdAt.toISOString(),
      };
    } catch (error) {
      this.logger.error('일반 결제 실패', error);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // Flow 2: 정기 결제 (스케줄러 호출)
  // -------------------------------
  @Post('recurring')
  @ApiOperation({
    summary: '정기 결제 실행 (스케줄러 전용)',
    description: `
스케줄러에서 호출하는 정기 결제 처리:
- actor: SCHEDULER로 자동 설정
- metadata에 isSubscriptionPayment: true 자동 추가
- 실패 시 재시도 로직은 스케줄러에서 처리
    `,
  })
  @ApiResponse({
    status: 200,
    description: '정기 결제 성공',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        paymentEventId: {
          type: 'string',
          example: '01K4HPR5HAKFQ576BP06H4Y027',
        },
        sessionId: {
          type: 'string',
          example: '01K4HPR5HAKFQ576BP06H4Y028',
        },
        pgTransactionId: { type: 'string', example: 'N/A' },
        status: { type: 'string', example: 'CAPTURED' },
        amount: { type: 'number', example: 50000 },
        processedAt: { type: 'string', example: '2025-09-07T09:00:00.000Z' },
      },
    },
  })
  @ApiBadRequestResponse({ description: '잘못된 요청' })
  @ApiNotFoundResponse({ description: '결제수단을 찾을 수 없음' })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async processRecurring(
    @Body()
    dto: {
      userId: string;
      paymentMethodId: string;
      amount: number;
      currency?: string;
      metadata?: any;
      pricingSnapshot?: any;
    },
  ) {
    try {
      this.logger.log(
        `정기 결제 실행: ${dto.paymentMethodId}, ${dto.amount}원`,
      );

      const result = await this.paymentService.processPayment({
        userId: dto.userId,
        paymentMethodId: dto.paymentMethodId,
        amount: dto.amount,
        currency: dto.currency || 'KRW',
        metadata: {
          ...dto.metadata,
          isSubscriptionPayment: true,
          paymentPurpose: 'SUBSCRIPTION',
          source: 'scheduler',
        },
        pricingSnapshot: dto.pricingSnapshot,
        actor: 'SCHEDULER',
      });

      return {
        success: true,
        paymentEventId: result.paymentEventId,
        sessionId: result.sessionId, // 세션 ID 필수 반환
        pgTransactionId: 'N/A', // 새 스키마에서는 event_context에 포함
        status: result.status,
        amount: result.amount,
        processedAt: result.createdAt,
      };
    } catch (error) {
      this.logger.error('정기 결제 실패', error);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // Flow 3: 멤버십 결제
  // -------------------------------
  @Post('membership')
  @ApiOperation({
    summary: '멤버십 결제 실행',
    description: `
멤버십 관련 결제 처리:
- actor: USER로 설정
- metadata에 paymentPurpose: SUBSCRIPTION 자동 추가
- 멤버십 구독 결제 전용 엔드포인트
    `,
  })
  @ApiResponse({
    status: 200,
    description: '멤버십 결제 성공',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        paymentEventId: {
          type: 'string',
          example: '01K4HPR5HAKFQ576BP06H4Y027',
        },
        sessionId: {
          type: 'string',
          example: '01K4HPR5HAKFQ576BP06H4Y028',
        },
        pgTransactionId: { type: 'string', example: 'N/A' },
        status: { type: 'string', example: 'CAPTURED' },
        amount: { type: 'number', example: 50000 },
        processedAt: { type: 'string', example: '2025-09-07T09:00:00.000Z' },
      },
    },
  })
  @ApiBadRequestResponse({ description: '잘못된 요청' })
  @ApiNotFoundResponse({ description: '결제수단을 찾을 수 없음' })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async processMembership(
    @Body()
    dto: {
      userId: string;
      paymentMethodId: string;
      amount: number;
      currency?: string;
      metadata?: any;
      pricingSnapshot?: any;
    },
  ) {
    try {
      this.logger.log(
        `멤버십 결제 실행: ${dto.paymentMethodId}, ${dto.amount}원`,
      );

      const result = await this.paymentService.processPayment({
        userId: dto.userId,
        paymentMethodId: dto.paymentMethodId,
        amount: dto.amount,
        currency: dto.currency || 'KRW',
        metadata: {
          ...dto.metadata,
          paymentPurpose: 'SUBSCRIPTION',
          source: 'api',
        },
        pricingSnapshot: dto.pricingSnapshot,
        actor: 'USER',
      });

      return {
        success: true,
        paymentEventId: result.paymentEventId,
        sessionId: result.sessionId, // 세션 ID 필수 반환
        pgTransactionId: 'N/A', // 새 스키마에서는 event_context에 포함
        status: result.status,
        amount: result.amount,
        processedAt: result.createdAt,
      };
    } catch (error) {
      this.logger.error('멤버십 결제 실패', error);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // Flow 4: BNPL 배치 처리
  // -------------------------------
  @Patch('bnpl-batch/:batchId/capture')
  @ApiOperation({
    summary: 'BNPL 배치 출금 실행 (스케줄러 전용)',
    description: 'BNPL 배치 결제의 실제 출금 실행',
  })
  @ApiParam({ name: 'batchId', description: 'BNPL 배치 ID' })
  @ApiResponse({ status: 200, description: 'BNPL 배치 출금 성공' })
  async captureBnplBatch(@Param('batchId') batchId: string) {
    try {
      this.logger.log(`BNPL 배치 출금 실행: ${batchId}`);

      const result = await this.paymentService.processBnplBatch({
        batchId,
        actor: 'SCHEDULER',
      });

      return {
        success: true,
        batchId,
        processedCount: result.processedCount,
        totalAmount: result.totalAmount,
        processedAt: result.processedAt,
      };
    } catch (error) {
      this.logger.error('BNPL 배치 출금 실패', error);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // Flow 5: 환불
  // -------------------------------
  @Post('refund')
  @ApiOperation({
    summary: '결제 환불 실행',
    description: `
결제 이벤트를 대상으로 환불을 실행합니다.

- **전액 환불**: amount를 지정하지 않으면 전액 환불
- **부분 환불**: amount 지정 시 해당 금액만 환불
- **환불 계좌 지정**: refundAccountId 제공 시 계좌로 환불
- actor는 항상 USER로 설정됩니다.
  `,
  })
  @ApiResponse({
    status: 200,
    description: '환불 성공',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        refundEventId: {
          type: 'string',
          example: 're_01K4HPR8YXYG7N2XBHQV4T7W1Z',
        },
        sessionId: {
          type: 'string',
          example: '01K4HPR5HAKFQ576BP06H4Y028',
        },
        refundedAmount: { type: 'number', example: 50000 },
        status: { type: 'string', example: 'REFUNDED' },
        processedAt: { type: 'string', example: '2025-09-07T10:15:30.000Z' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: '잘못된 요청 (금액 초과, 이미 환불됨 등)',
  })
  @ApiNotFoundResponse({ description: '결제 이벤트를 찾을 수 없음' })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async refund(@Body() dto: RefundRequestDto) {
    try {
      this.logger.log(
        `환불 실행: ${dto.paymentEventId}, ${dto.amount || '전액'}원`,
      );

      const result = await this.refundService.processRefund({
        paymentEventId: dto.paymentEventId,
        amount: dto.amount,
        reason: dto.reason || '고객 요청',
        refundAccountId: dto.refundAccountId,
        actor: 'USER',
      });

      return {
        success: true,
        refundEventId: result.refundEventId,
        sessionId: result.sessionId, // 세션 ID 필수 반환
        refundedAmount: result.amount,
        status: result.status,
        processedAt: result.createdAt,
      };
    } catch (error) {
      this.logger.error('환불 실패', error);
      throw this.mapErrorToHttpException(error);
    }
  }
  // -------------------------------
  // Flow 6: 결제수단 등록
  // -------------------------------
  @Post('payment-methods')
  @ApiOperation({
    summary: '결제수단 등록',
    description: '새로운 결제수단을 등록합니다',
  })
  @ApiResponse({ status: 200, description: '결제수단 등록 성공' })
  async registerMethod(
    @Body()
    dto: {
      userId: string;
      methodType: 'CARD' | 'BNPL' | 'REWARD_POINT';
      methodName: string;
      paymentPurpose?: 'SUBSCRIPTION' | 'PURCHASE' | 'BOTH';
      isDefault?: boolean;
      // 카드 등록 시 필요한 정보
      cardToken?: string;
      billingKey?: string;
      // BNPL 등록 시 필요한 정보
      creditLimit?: number;
      billingCycleDay?: number;
    },
  ) {
    try {
      this.logger.log(`결제수단 등록: ${dto.userId}, ${dto.methodType}`);

      const result = await this.paymentMethodService.register({
        userId: dto.userId,
        methodType: dto.methodType as any,
        methodName: dto.methodName,
        paymentPurpose: dto.paymentPurpose || 'PURCHASE',
        isDefault: dto.isDefault || false,
        cardToken: dto.cardToken,
        billingKey: dto.billingKey,
        creditLimit: dto.creditLimit,
        billingCycleDay: dto.billingCycleDay,
      });

      return {
        success: true,
        paymentMethodId: result.paymentMethodId,
        status: result.status,
        hmsMemberId: result.hmsMemberId,
        createdAt: result.createdAt,
      };
    } catch (error) {
      this.logger.error('결제수단 등록 실패', error);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // 결제 상태 조회 (공통)
  // -------------------------------
  @Get(':paymentEventId/status')
  @ApiOperation({
    summary: '결제 상태 조회',
    description: '결제 이벤트 ID로 결제 상태를 조회합니다',
  })
  @ApiParam({ name: 'paymentEventId', description: '결제 이벤트 ID' })
  @ApiResponse({ status: 200, description: '결제 상태 조회 성공' })
  async getPaymentStatus(@Param('paymentEventId') paymentEventId: string) {
    try {
      this.logger.log(`결제 상태 조회: ${paymentEventId}`);

      const result = await this.paymentService.getPaymentStatus(paymentEventId);

      return {
        paymentEventId: result.id,
        status: result.status,
        amount: result.amount,
        pgTransactionId: result.pgTransactionId,
        createdAt: result.createdAt,
        metadata: result.metadata,
        pricingSnapshot: result.pricingSnapshot,
      };
    } catch (error) {
      this.logger.error('결제 상태 조회 실패', error);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // 6. 결제 세션 생성
  // -------------------------------
  @Post('session')
  @ApiOperation({
    summary: '결제 세션 생성',
    description: `
결제 세션을 미리 생성합니다.
생성된 세션 ID는 이후 결제 실행 시 사용할 수 있습니다.
    `,
  })
  @ApiResponse({
    status: 201,
    description: '세션 생성 성공',
    schema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          example: '01K4HPR5HAKFQ576BP06H4Y027',
        },
        status: {
          type: 'string',
          example: 'PENDING',
        },
        checkout: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              example:
                'https://checkout.example.com/session/01K4HPR5HAKFQ576BP06H4Y027',
            },
          },
        },
        metadata: {
          type: 'object',
          example: {
            paymentPurpose: 'PURCHASE',
            productName: '테스트 상품',
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: '잘못된 요청',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: { type: 'string', example: '필수 필드가 누락되었습니다' },
      },
    },
  })
  async createSession(
    @Body()
    dto: {
      userId: string;
      amount: number;
      currency?: string;
      metadata?: Record<string, any>;
    },
  ) {
    try {
      this.logger.log(
        `세션 생성 요청: 사용자=${dto.userId}, 금액=${dto.amount}`,
      );

      const result = await this.paymentSessionService.createSession({
        userId: dto.userId,
        amount: dto.amount,
        currency: dto.currency || 'KRW',
        metadata: dto.metadata || {},
      });

      return {
        sessionId: result.sessionId,
        status: result.status,
        checkout: result.checkout,
        metadata: result.metadata,
      };
    } catch (error) {
      this.logger.error('세션 생성 실패', error);
      throw this.mapErrorToHttpException(error);
    }
  }
}
