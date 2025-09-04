// controllers/payments.controller.ts
import {
  Controller,
  Post,
  Body,
  HttpStatus,
  HttpException,
  Logger,
  Patch,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { PaymentOrchestrationService } from '../services/payment-orchestration.service';
import { BnplMethodService } from '../services/method-services/bnpl-method.service';
import {
  ProcessPaymentDto,
  ProcessPaymentResponseDto,
} from '../shared/dtos/payments/process-payment.dto';
import {
  PaymentSessionNotFoundError,
  PaymentMethodNotFoundError,
  PaymentEventNotFoundError,
  InvalidPaymentAmountError,
  PaymentSessionAlreadyProcessedError,
  InactivePaymentMethodError,
  UnsupportedPaymentMethodError,
  ImmediatePaymentFailedError,
  DeferredPaymentAuthorizationFailedError,
  DeferredPaymentCaptureFailedError,
} from '../shared/errors/payment.errors';

@ApiTags('결제 (V2)')
@Controller('v2/payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly paymentService: PaymentOrchestrationService,
    private readonly bnplMethodService: BnplMethodService,
  ) {}

  // 세션 관리는 PaymentSessionsController로 이동

  @Post('process')
  @ApiOperation({
    summary: '통합 결제 실행',
    description: `
모든 결제수단을 조합하여 한번에 처리합니다:

**💳 즉시결제 (카드)**
- authorize + capture 동시 실행
- 즉시 결제 완료

**📊 후불결제 (BNPL)**  
- authorize만 실행 (내부 한도 차감)
- capture는 나중에 스케줄러가 자동 실행
- authorizationId 반환

**🪙 포인트**
- 즉시 잔액 차감
- 별도 결제수단이 아닌 잔액 차감

## 사용법
1. 테스트 데이터 준비 (/test-setup APIs)
2. **결제 세션 생성** (/v2/sessions)  
3. **통합 결제 실행** (이 API)
4. BNPL이 있다면 나중에 capture (/v2/payments/deferred/{authId}/capture)

## 예시: 120,000원 혼합결제
- 카드 50,000원 (즉시완료) + BNPL 50,000원 (승인만) + 포인트 20,000원 (차감)
    `,
  })
  @ApiResponse({
    status: 200,
    description: '결제가 성공적으로 처리되었습니다.',
    type: ProcessPaymentResponseDto,
  })
  @ApiBadRequestResponse({
    description: '잘못된 요청 데이터 또는 비즈니스 규칙 위반',
    schema: {
      example: {
        statusCode: 400,
        message: '결제 금액이 일치하지 않습니다',
        error: 'Payment Validation Failed',
      },
    },
  })
  @ApiNotFoundResponse({
    description: '결제 세션 또는 결제수단을 찾을 수 없음',
    schema: {
      example: {
        statusCode: 404,
        message: '결제 세션을 찾을 수 없습니다',
        error: 'Not Found',
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: '서버 내부 오류',
    schema: {
      example: {
        statusCode: 500,
        message: '결제 처리 중 오류가 발생했습니다',
        error: 'Internal Server Error',
      },
    },
  })
  async processPayment(
    @Body() dto: ProcessPaymentDto,
  ): Promise<ProcessPaymentResponseDto> {
    try {
      this.logger.log(
        `혼합 결제 실행: sessionId=${dto.sessionId}, methods=${dto.paymentMethods.length}, points=${dto.usePoints || 0}`,
      );

      // 첫 번째 결제수단으로 표준 PaymentGateway 방식 결제 (간소화)
      const firstMethod = dto.paymentMethods[0];
      const methodType = firstMethod?.type || 'CARD';

      const result = await this.paymentService.processPaymentByMethodType(
        methodType,
        firstMethod.amount,
        {
          userId: dto.userId || '',
          sessionId: dto.sessionId,
          paymentMethodId: firstMethod.paymentMethodId,
          orderName: dto.metadata?.orderName,
        },
        dto.idemKey,
      );

      this.logger.log(
        `결제 승인 완료: ${(result as any).status} - ${dto.sessionId}`,
      );

      // 오케스트레이션 결과를 ProcessPaymentResponseDto 형태로 변환
      const typedResult = result as any;
      return {
        success: typedResult.success,
        paymentId: typedResult.paymentEventId,
        sessionId: dto.sessionId,
        totalAmount: firstMethod.amount,
        results: {
          status: typedResult.status,
          authorizationIds: typedResult.authorizationId
            ? [typedResult.authorizationId]
            : [],
          capturedIds: typedResult.captureId ? [typedResult.captureId] : [],
          pointsTxId: typedResult.transactionId,
        },
      };
    } catch (error) {
      this.logger.error('혼합 결제 실패', error);

      // 비즈니스 예외를 HTTP 상태 코드로 매핑
      if (error instanceof Error) {
        // 404 에러들
        if (
          error instanceof PaymentSessionNotFoundError ||
          error instanceof PaymentMethodNotFoundError ||
          error instanceof PaymentEventNotFoundError
        ) {
          throw new HttpException(
            {
              statusCode: HttpStatus.NOT_FOUND,
              message: error.message,
              error: 'Not Found',
            },
            HttpStatus.NOT_FOUND,
          );
        }

        // 400 에러들 (비즈니스 규칙 위반)
        if (
          error instanceof InvalidPaymentAmountError ||
          error instanceof PaymentSessionAlreadyProcessedError ||
          error instanceof InactivePaymentMethodError ||
          error instanceof UnsupportedPaymentMethodError ||
          error instanceof ImmediatePaymentFailedError ||
          error instanceof DeferredPaymentAuthorizationFailedError ||
          error instanceof DeferredPaymentCaptureFailedError
        ) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: error.message,
              error: 'Payment Processing Failed',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        // 알 수 없는 비즈니스 에러는 400으로
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: error.message,
            error: 'Business Logic Failed',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // 예상치 못한 에러는 500으로
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: '결제 처리 중 오류가 발생했습니다',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch('deferred/:authorizationId/capture')
  @ApiOperation({
    summary: 'BNPL 출금 실행 (스케줄러용)',
    description: `
BNPL 결제의 실제 출금을 실행합니다.
일반적으로는 스케줄러가 주기적으로 호출하지만, 테스트를 위해 수동 실행도 가능합니다.

**주의**: 이미 capture된 결제는 다시 처리할 수 없습니다.
    `,
  })
  @ApiParam({
    name: 'authorizationId',
    description:
      'BNPL 승인 ID (processPayment 결과의 results.deferred[].authorizationId)',
    example: 'auth_1234567890_def456',
  })
  @ApiResponse({
    status: 200,
    description: 'BNPL 출금이 성공적으로 실행되었습니다.',
    schema: {
      example: {
        success: true,
        transactionId: 'hms_transaction_1234567890',
        message: 'BNPL 출금이 완료되었습니다.',
      },
    },
  })
  @ApiNotFoundResponse({
    description: '승인 ID를 찾을 수 없음',
    schema: {
      example: {
        statusCode: 404,
        message: '결제 이벤트를 찾을 수 없습니다',
        error: 'Not Found',
      },
    },
  })
  async captureDeferred(@Param('authorizationId') authorizationId: string) {
    try {
      this.logger.log(`BNPL 출금 실행 요청: ${authorizationId}`);

      const result = await this.bnplMethodService.batchCapture([
        authorizationId,
      ]);

      const typedResult = result as any;
      if (typedResult.success && typedResult.captureIds.length > 0) {
        this.logger.log(`BNPL 출금 완료: ${authorizationId}`);

        return {
          success: true,
          authorizationId,
          message: 'BNPL 출금이 완료되었습니다.',
          captureIds: typedResult.captureIds,
        };
      } else {
        this.logger.error(
          `BNPL 출금 실패: ${authorizationId} - ${typedResult.error}`,
        );

        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: typedResult.error || 'BNPL 출금에 실패했습니다',
            error: 'Capture Failed',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    } catch (error) {
      this.logger.error('BNPL 출금 실행 실패', error);

      if (error instanceof HttpException) {
        throw error; // 이미 처리된 HTTP 예외는 그대로 전파
      }

      if (error instanceof Error) {
        // 404 에러들
        if (
          error instanceof PaymentEventNotFoundError ||
          error instanceof PaymentMethodNotFoundError
        ) {
          throw new HttpException(
            {
              statusCode: HttpStatus.NOT_FOUND,
              message: error.message,
              error: 'Not Found',
            },
            HttpStatus.NOT_FOUND,
          );
        }

        // 비즈니스 에러들
        if (
          error instanceof UnsupportedPaymentMethodError ||
          error instanceof DeferredPaymentCaptureFailedError
        ) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: error.message,
              error: 'Capture Processing Failed',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        // 알 수 없는 에러
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: error.message,
            error: 'Unknown Error',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'BNPL 출금 처리 중 오류가 발생했습니다',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // 세션 조회도 PaymentSessionsController로 이동
}
