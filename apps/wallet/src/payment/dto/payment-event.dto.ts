import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * 결제 이벤트 생성 스키마
 */
export const CreatePaymentEventSchema = z.object({
  invoiceId: z.number().int().positive(),
  paymentMethodId: z.string().length(26),
  amount: z.string(),
  status: z.enum(['REQUESTED', 'SUCCESS', 'FAILED', 'DUPLICATE_ATTEMPT']),
  pgTransactionId: z.string().max(255).optional(),
  pgResponse: z.string().optional(),
  actor: z.enum(['USER', 'SCHEDULER', 'ADMIN']),
});

/**
 * 결제 이벤트 생성 DTO
 */
export class CreatePaymentEventDto extends createZodDto(
  CreatePaymentEventSchema,
) {}

/**
 * 결제 요청 스키마
 */
export const PaymentRequestSchema = z.object({
  invoiceId: z.number().int().positive(),
  paymentMethodId: z.string().length(26),
  amount: z.string(),
  actor: z.enum(['USER', 'SCHEDULER', 'ADMIN']).default('USER'),
});

/**
 * 결제 요청 DTO
 */
export class PaymentRequestDto extends createZodDto(PaymentRequestSchema) {}

/**
 * 결제 성공 스키마
 */
export const PaymentSuccessSchema = z.object({
  invoiceId: z.number().int().positive(),
  paymentMethodId: z.string().length(26),
  amount: z.string(),
  pgTransactionId: z.string(),
  pgResponse: z.string().optional(),
  actor: z.enum(['USER', 'SCHEDULER', 'ADMIN']).default('SCHEDULER'),
});

/**
 * 결제 성공 DTO
 */
export class PaymentSuccessDto extends createZodDto(PaymentSuccessSchema) {}

/**
 * 결제 실패 스키마
 */
export const PaymentFailureSchema = z.object({
  invoiceId: z.number().int().positive(),
  paymentMethodId: z.string().length(26),
  amount: z.string(),
  pgResponse: z.string().optional(),
  actor: z.enum(['USER', 'SCHEDULER', 'ADMIN']).default('USER'),
});

/**
 * 결제 실패 DTO
 */
export class PaymentFailureDto extends createZodDto(PaymentFailureSchema) {}
