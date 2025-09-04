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
import { PaymentService } from '../services/payment.service';
import {
  PaymentResultDto,
  ProcessPaymentDto,
  ProcessPaymentResponseDto,
} from '../shared/dtos/payments/process-payment.dto';

@ApiTags('결제 (V2)')
@Controller('v2/payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentService) {}

  // -------------------------------
  // 통합 결제 실행
  // -------------------------------
  @Post('process')
  @ApiOperation({
    summary: '통합 결제 실행',
    description: `
모든 결제수단을 조합하여 한번에 처리합니다:

- 카드: authorize + capture → CAPTURED  
- BNPL: authorize만 → AUTHORIZED (추후 capture 필요)  
- 포인트: 즉시 차감 → CAPTURED  
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
        message: '결제 금액이 올바르지 않습니다',
        error: 'Bad Request',
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
        message: '결제 처리 중 알 수 없는 오류가 발생했습니다',
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

      const firstMethod = dto.paymentMethods[0];
      const methodType = firstMethod?.type || 'CARD';

      const result = await this.paymentService.processPayment(
        methodType,
        firstMethod.amount,
        'KRW',
        {
          userId: dto.userId || '',
          sessionId: dto.sessionId,
          paymentMethodId: firstMethod.paymentMethodId,
          orderName: dto.metadata?.orderName,
        },
        dto.idemKey,
      );

      const typedResult = result as any;

      const paymentResult: PaymentResultDto = {
        methodType,
        amount: firstMethod.amount,
        status: typedResult.status,
        authorizationIds: typedResult.authorizationId
          ? [typedResult.authorizationId]
          : [],
        captureIds: typedResult.captureId ? [typedResult.captureId] : [],
        transactionId: typedResult.transactionId,
      };

      return {
        success: typedResult.success,
        paymentId: typedResult.paymentEventId,
        sessionId: dto.sessionId,
        totalAmount: dto.paymentMethods.reduce(
          (sum, m) => sum + (m.amount || 0),
          0,
        ),
        results: [paymentResult],
      };
    } catch (error) {
      this.logger.error('혼합 결제 실패', error);

      if (error.message?.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      if (
        error.message?.includes('required') ||
        error.message?.includes('invalid') ||
        error.message?.includes('unsupported') ||
        error.message?.includes('already processed') ||
        error.message?.includes('failed')
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }

      throw new HttpException(
        '결제 처리 중 알 수 없는 오류가 발생했습니다',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // -------------------------------
  // BNPL 출금 실행
  // -------------------------------
  @Patch('deferred/:authorizationId/capture')
  @ApiOperation({
    summary: 'BNPL 출금 실행 (스케줄러/수동)',
    description: `
BNPL 결제의 실제 출금을 실행합니다.  
- AUTHORIZED → CAPTURED 로 상태 변경  
- 이미 CAPTURED 된 건은 재실행 불가  
    `,
  })
  @ApiParam({
    name: 'authorizationId',
    description: 'BNPL 승인 ID',
    example: 'auth_1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'BNPL 출금이 성공적으로 실행되었습니다.',
    type: ProcessPaymentResponseDto,
  })
  @ApiBadRequestResponse({
    description: '출금 처리 실패',
    schema: {
      example: {
        statusCode: 400,
        message: 'BNPL 출금에 실패했습니다',
        error: 'Bad Request',
      },
    },
  })
  @ApiNotFoundResponse({
    description: '승인 ID를 찾을 수 없음',
    schema: {
      example: {
        statusCode: 404,
        message: '승인건을 찾을 수 없습니다',
        error: 'Not Found',
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: '서버 내부 오류',
    schema: {
      example: {
        statusCode: 500,
        message: 'BNPL 출금 처리 중 알 수 없는 오류가 발생했습니다',
        error: 'Internal Server Error',
      },
    },
  })
  async captureDeferred(
    @Param('authorizationId') authorizationId: string,
  ): Promise<ProcessPaymentResponseDto> {
    try {
      this.logger.log(`BNPL 출금 실행 요청: ${authorizationId}`);

      const result = await this.paymentService.batchCapture('BNPL', [
        authorizationId,
      ]);
      const typedResult = result as any;

      if (typedResult.success && typedResult.captureIds.length > 0) {
        const paymentResult: PaymentResultDto = {
          methodType: 'BNPL',
          amount: typedResult.amount || 0,
          status: 'CAPTURED',
          authorizationIds: [authorizationId],
          captureIds: typedResult.captureIds,
        };

        return {
          success: true,
          paymentId: typedResult.paymentEventId || '',
          sessionId: typedResult.sessionId || '',
          totalAmount: typedResult.amount || 0,
          results: [paymentResult],
        };
      }

      throw new Error(typedResult.error || 'BNPL 출금 실패');
    } catch (error) {
      this.logger.error('BNPL 출금 실행 실패', error);

      if (error.message?.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      if (
        error.message?.includes('already processed') ||
        error.message?.includes('failed') ||
        error.message?.includes('invalid')
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }

      throw new HttpException(
        'BNPL 출금 처리 중 알 수 없는 오류가 발생했습니다',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
