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
import { RefundService } from '../services/refund.service';
import { PaymentMethodType } from '../shared/types/payment-method.types';

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
    @Body()
    dto: {
      userId: string;
      paymentMethodId: string;
      amount: number;
      currency?: string;
      sessionId?: string;
      metadata?: any;
      pricingSnapshot?: any;
    },
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ) {
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
        success: true,
        paymentEventId: result.paymentEventId,
        transactionId: result.pgTransactionId,
        status: result.status,
        amount: result.amount,
        processedAt: result.createdAt,
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
    description: '스케줄러에서 호출하는 정기 결제 처리',
  })
  @ApiResponse({ status: 200, description: '정기 결제 성공' })
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
        transactionId: result.pgTransactionId,
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
    description: '멤버십 관련 결제 처리',
  })
  @ApiResponse({ status: 200, description: '멤버십 결제 성공' })
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
        transactionId: result.pgTransactionId,
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
    description: '결제 건에 대해 환불을 실행합니다',
  })
  @ApiResponse({ status: 200, description: '환불 성공' })
  async refund(
    @Body()
    dto: {
      paymentEventId: string;
      amount?: number;
      reason?: string;
      refundAccountId?: string;
    },
  ) {
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
        methodType: dto.methodType as PaymentMethodType,
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
}
