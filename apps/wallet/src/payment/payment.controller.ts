// src/payment/controller/payment.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { ProcessPaymentDto } from './dto/process-payment.dto';


@Controller('payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentService) { }

  @Post()
  @HttpCode(HttpStatus.OK) // 성공 시 200 OK 반환
  async processPayment(@Body() processPaymentDto: ProcessPaymentDto) {
    this.logger.log(`결제 요청 수신: ${JSON.stringify(processPaymentDto)}`);

    // 서비스 계층에 실제 로직 처리를 위임합니다.
    return this.paymentService.processPayment(processPaymentDto);
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


}
