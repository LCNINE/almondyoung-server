import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApprovePaymentDto } from '../shared/dtos/payments/approve-payment.dto';
import {
  ApprovePaymentResponse,
  PaymentsService,
} from '../services/payments.service';
import { CapturePaymentDto } from '../shared/dtos/payments/capture-payment.dto';
import { CapturePaymentResponse } from '../services/payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @ApiOperation({ summary: '결제 승인 (PENDING → AUTHORIZED)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    description:
      '엔드포인트 단위 고유 키. 같은 키+같은 요청 → 동일 응답, 다른 요청 → 409 Conflict',
    required: false,
    example: 'idem_approve_123456789',
  })
  @Post('approve')
  @HttpCode(200)
  async approve(
    @Body() dto: ApprovePaymentDto,
    @Headers('Idempotency-Key') idemKey?: string, // ← 대소문자 맞춤 (Swagger 표기와 동일하게)
  ): Promise<ApprovePaymentResponse> {
    return await this.service.approve(dto, idemKey);
  }

  @ApiOperation({ summary: '결제 캡처 (AUTHORIZED → CAPTURED)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: '엔드포인트 단위 고유 키',
    required: false,
    example: 'idem_capture_123',
  })
  @Post(':paymentEventId/capture')
  @HttpCode(200)
  async capture(
    @Param('paymentEventId') paymentEventId: string,
    @Body() dto: CapturePaymentDto,
    @Headers('Idempotency-Key') idemKey?: string,
  ): Promise<CapturePaymentResponse> {
    return await this.service.capture(paymentEventId, dto, idemKey);
  }
}
