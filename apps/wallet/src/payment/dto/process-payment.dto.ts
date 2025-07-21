// src/payment/dto/process-payment.dto.ts (수정)

import { IsString, IsNotEmpty } from 'class-validator';

export class ProcessPaymentDto {
  @IsString()
  @IsNotEmpty()
  invoiceId: string;

  @IsString()
  @IsNotEmpty()
  paymentMethodId: string; // ✅ 사용자가 선택한 결제수단 ID
}
