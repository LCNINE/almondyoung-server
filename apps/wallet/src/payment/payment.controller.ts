// src/payment/controller/payment.controller.ts
import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentSessionService } from '../payment-session/services/payment-session.service';
import { 
  ProcessPaymentDto, 
  AuthorizePaymentDto, 
  CapturePaymentDto 
} from './dto/process-payment.dto';
import {
  CreatePaymentSessionDto,
  UpdatePaymentSessionDto,
} from '../payment-session/dto';
import {
  PaymentAuthorizationResult,
  PaymentCaptureResult,
} from './types/payment-response.types';


@Controller('payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly paymentSessionService: PaymentSessionService,
  ) { }

  @Post()
  @HttpCode(HttpStatus.OK) // 성공 시 200 OK 반환
  async processPayment(@Body() processPaymentDto: ProcessPaymentDto) {
    this.logger.log(`결제 요청 수신: ${JSON.stringify(processPaymentDto)}`);

    // 서비스 계층에 실제 로직 처리를 위임합니다.
    return this.paymentService.processPayment(processPaymentDto);
  }

  @Post('authorize')
  async authorizePayment(@Body() authorizePaymentDto: AuthorizePaymentDto): Promise<PaymentAuthorizationResult> {
    this.logger.log(`결제 승인 요청 수신: ${JSON.stringify(authorizePaymentDto)}`);

    try {
      return await this.paymentService.authorizePayment(authorizePaymentDto);
    } catch (error) {
      this.logger.error(`결제 승인 실패: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post('capture')
  async capturePayment(@Body() capturePaymentDto: CapturePaymentDto): Promise<PaymentCaptureResult> {
    this.logger.log(`결제 캡처 요청 수신: ${JSON.stringify(capturePaymentDto)}`);

    try {
      return await this.paymentService.capturePayment(capturePaymentDto);
    } catch (error) {
      this.logger.error(`결제 캡처 실패: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('events/:id')
  async getPaymentEvent(@Param('id') paymentEventId: string) {
    this.logger.log(`PaymentEvent 조회 요청: ${paymentEventId}`);

    // 임시 구현: 실제로는 PaymentEvent 테이블에서 조회해야 함
    return {
      success: true,
      data: {
        id: paymentEventId,
        status: 'AUTHORIZED',
        amount: '8000.0000',
        paymentMethodId: 'temp_method_id',
        createdAt: new Date().toISOString()
      }
    };
  }

  // ═══════════════════════════════════════════
  // 🎯 PaymentSession 관리 API
  // ═══════════════════════════════════════════

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  async createPaymentSession(@Body() createDto: CreatePaymentSessionDto) {
    this.logger.log(`결제 세션 생성 요청: ${JSON.stringify(createDto)}`);

    try {
      const paymentSession = await this.paymentSessionService.create(createDto);
      return {
        success: true,
        data: paymentSession,
        message: '결제 세션이 성공적으로 생성되었습니다.',
      };
    } catch (error) {
      this.logger.error(`결제 세션 생성 실패: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('sessions/:id')
  async getPaymentSession(@Param('id') id: string) {
    this.logger.log(`결제 세션 조회 요청: ${id}`);

    try {
      const paymentSession = await this.paymentSessionService.findById(id);
      if (!paymentSession) {
        return {
          success: false,
          message: '결제 세션을 찾을 수 없습니다.',
        };
      }

      return {
        success: true,
        data: paymentSession,
      };
    } catch (error) {
      this.logger.error(`결제 세션 조회 실패: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Put('sessions/:id')
  async updatePaymentSession(
    @Param('id') id: string,
    @Body() updateDto: UpdatePaymentSessionDto,
  ) {
    this.logger.log(`결제 세션 업데이트 요청: ${id}, ${JSON.stringify(updateDto)}`);

    try {
      const paymentSession = await this.paymentSessionService.update(id, updateDto);
      return {
        success: true,
        data: paymentSession,
        message: '결제 세션이 성공적으로 업데이트되었습니다.',
      };
    } catch (error) {
      this.logger.error(`결제 세션 업데이트 실패: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Delete('sessions/:id')
  async cancelPaymentSession(@Param('id') id: string) {
    this.logger.log(`결제 세션 취소 요청: ${id}`);

    try {
      const paymentSession = await this.paymentSessionService.updateStatus(id, 'CANCELLED');
      return {
        success: true,
        data: paymentSession,
        message: '결제 세션이 성공적으로 취소되었습니다.',
      };
    } catch (error) {
      this.logger.error(`결제 세션 취소 실패: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ═══════════════════════════════════════════
  // 🎯 결제 처리 API
  // ═══════════════════════════════════════════

  @Post('sessions/:id/capture')
  @HttpCode(HttpStatus.OK)
  async capturePaymentSession(
    @Param('id') paymentSessionId: string,
    @Body() captureDto?: { amount?: number; pgTransactionId?: string },
  ) {
    this.logger.log(`결제 세션 캡처 요청: ${paymentSessionId}, ${JSON.stringify(captureDto)}`);

    try {
      // PaymentSession에서 PaymentEvent를 찾아서 캡처 처리
      const paymentSession = await this.paymentSessionService.findById(paymentSessionId);
      if (!paymentSession) {
        return {
          success: false,
          message: '결제 세션을 찾을 수 없습니다.',
        };
      }

      // 임시로 첫 번째 PaymentEvent를 사용 (실제로는 PaymentEvent 조회 로직 필요)
      // TODO: PaymentEvent 조회 로직 구현 필요
      const capturePayload: CapturePaymentDto = {
        paymentEventId: 'temp_payment_event_id', // 실제로는 PaymentEvent 조회 필요
        amount: captureDto?.amount,
        pgTransactionId: captureDto?.pgTransactionId,
      };

      const result = await this.paymentService.capturePayment(capturePayload);
      
      // PaymentSession 상태도 CAPTURED로 업데이트
      await this.paymentSessionService.updateStatus(paymentSessionId, 'CAPTURED');

      return {
        success: true,
        data: result,
        message: '결제가 성공적으로 캡처되었습니다.',
      };
    } catch (error) {
      this.logger.error(`결제 캡처 실패: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post('sessions/:id/refund')
  @HttpCode(HttpStatus.OK)
  async refundPaymentSession(
    @Param('id') paymentSessionId: string,
    @Body() refundDto: { amount?: number; reason?: string },
  ) {
    this.logger.log(`결제 세션 환불 요청: ${paymentSessionId}, ${JSON.stringify(refundDto)}`);

    try {
      // PaymentSession 상태 확인
      const paymentSession = await this.paymentSessionService.findById(paymentSessionId);
      if (!paymentSession) {
        return {
          success: false,
          message: '결제 세션을 찾을 수 없습니다.',
        };
      }

      if (paymentSession.status !== 'CAPTURED') {
        return {
          success: false,
          message: '캡처된 결제만 환불할 수 있습니다.',
        };
      }

      // TODO: 실제 환불 처리 로직 구현 필요
      // 1. PaymentEvent에서 환불 가능한 금액 확인
      // 2. RefundEvent 생성
      // 3. 외부 PG사에 환불 요청 (필요시)
      // 4. PaymentSession 상태를 REFUNDED로 업데이트

      await this.paymentSessionService.updateStatus(paymentSessionId, 'REFUNDED');

      return {
        success: true,
        data: {
          paymentSessionId,
          refundAmount: refundDto.amount || paymentSession.amount,
          reason: refundDto.reason || '사용자 요청',
          refundedAt: new Date(),
        },
        message: '환불이 성공적으로 처리되었습니다.',
      };
    } catch (error) {
      this.logger.error(`환불 처리 실패: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post('sessions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelPaymentSessionByPost(@Param('id') paymentSessionId: string) {
    this.logger.log(`결제 세션 취소 요청 (POST): ${paymentSessionId}`);

    try {
      const paymentSession = await this.paymentSessionService.findById(paymentSessionId);
      if (!paymentSession) {
        return {
          success: false,
          message: '결제 세션을 찾을 수 없습니다.',
        };
      }

      // PENDING 또는 AUTHORIZED 상태만 취소 가능
      if (!['PENDING', 'AUTHORIZED'].includes(paymentSession.status)) {
        return {
          success: false,
          message: `${paymentSession.status} 상태의 결제는 취소할 수 없습니다.`,
        };
      }

      const cancelledSession = await this.paymentSessionService.updateStatus(paymentSessionId, 'CANCELLED');

      return {
        success: true,
        data: cancelledSession,
        message: '결제가 성공적으로 취소되었습니다.',
      };
    } catch (error) {
      this.logger.error(`결제 취소 실패: ${error.message}`, error.stack);
      throw error;
    }
  }


}
