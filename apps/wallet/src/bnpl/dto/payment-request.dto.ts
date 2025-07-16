import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * BNPL 결제 요청 스키마
 */
export const PaymentRequestSchema = z.object({
  bnplAccountId: z.string(),
  invoiceId: z.number().int().positive(),
  amount: z.string(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * BNPL 결제 요청 DTO
 */
export class PaymentRequestDto extends createZodDto(PaymentRequestSchema) {}

/**
 * BNPL 결제 캡처 스키마
 */
export const PaymentCaptureSchema = z.object({
  paymentId: z.string(),
  amount: z.string(), // 캡처 금액 (없으면 전체 금액)
});

/**
 * BNPL 결제 캡처 DTO
 */
export class PaymentCaptureDto extends createZodDto(PaymentCaptureSchema) {}
