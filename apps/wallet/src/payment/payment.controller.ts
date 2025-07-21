// src/payment/controller/payment.controller.ts
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { ProcessPaymentDto } from './dto/process-payment.dto';

@Controller('payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  @HttpCode(HttpStatus.OK) // 성공 시 200 OK 반환
  async processPayment(@Body() processPaymentDto: ProcessPaymentDto) {
    this.logger.log(`결제 요청 수신: ${JSON.stringify(processPaymentDto)}`);

    // 서비스 계층에 실제 로직 처리를 위임합니다.
    return this.paymentService.processPayment(processPaymentDto);
  }
}
