import { Controller, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CreatePaymentMethodDto, UpdatePaymentMethodDto } from '../shared/zod';
import { VerifyPaymentMethodDto } from '../shared/zod';
import { PaymentMethodService } from './services/payment-method.service';

@Controller('payment-methods')
export class PaymentMethodController {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}

  /**
   * 결제수단 등록 (status=PENDING)
   */
  @Post()
  create(@Body() dto: CreatePaymentMethodDto) {
    return this.paymentMethodService.create(dto);
  }

  /**
   * 결제수단 정보 수정 (methodName, isDefault 등)
   */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePaymentMethodDto) {
    return this.paymentMethodService.update(id, dto);
  }

  /**
   * 은행 인증 결과 콜백 (status ACTIVE | FAILED)
   */
  @Patch(':id/verify')
  verify(@Param('id') id: string, @Body() dto: VerifyPaymentMethodDto) {
    return this.paymentMethodService.verifyStatus(id, dto.status as any);
  }

  /**
   * 결제수단 비활성화 (소프트 삭제)
   */
  @Delete(':id')
  deactivate(@Param('id') id: string) {
    return this.paymentMethodService.deactivate(id);
  }
}
