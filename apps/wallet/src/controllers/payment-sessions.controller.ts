/**
 * 결제 세션 컨트롤러
 * - 비즈니스 로직은 서비스로 위임
 * - Idempotency-Key 헤더 수집
 */
import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreatePaymentSessionDto } from '../shared/dtos/create-payment-session.dto';
import { PaymentSessionsService } from '../services/payment-sessions.service';

@ApiTags('payment-sessions')
@Controller('payment-sessions')
export class PaymentSessionsController {
  constructor(private readonly service: PaymentSessionsService) {}

  @ApiOperation({ summary: '결제 세션 생성 (SESSION_CREATED 이벤트 적재)' })
  @Post()
  @HttpCode(201)
  create(
    @Body() dto: CreatePaymentSessionDto,
    @Headers('idempotency-key') idemKey?: string,
  ) {
    return this.service.createSession(dto, idemKey);
  }
}
