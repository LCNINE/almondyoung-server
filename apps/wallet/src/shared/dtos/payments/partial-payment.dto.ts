// shared/dtos/payments/partial-payment.dto.ts
import { IsString, IsNumber, IsOptional, IsObject, Min } from 'class-validator';

/**
 * 부분결제 요청 DTO
 */
export class PartialPaymentDto {
  @IsString()
  sessionId: string;

  @IsString()
  paymentMethodId: string;

  @IsNumber()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  paymentKey?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * 부분결제 응답 DTO
 */
export interface PartialPaymentResponse {
  paymentId: string;
  sessionId: string;
  partialAmount: number;
  remainingAmount: number;
  totalPaidAmount: number;
  status: 'PARTIAL' | 'COMPLETED';
  pgTransactionId: string;
  authorizedAt: Date;
  metadata: Record<string, any>;
}
