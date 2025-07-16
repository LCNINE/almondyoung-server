import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * 환불 이벤트 생성 스키마
 */
export const CreateRefundEventSchema = z.object({
  paymentEventId: z.string().length(26),
  amount: z.number().positive(),
  status: z.enum(['REQUESTED', 'SUCCESS', 'FAILED']),
  reason: z.string().optional(),
});

/**
 * 환불 이벤트 생성 DTO
 */
export class CreateRefundEventDto extends createZodDto(CreateRefundEventSchema) {}

/**
 * 환불 요청 스키마
 */
export const RefundRequestSchema = z.object({
  paymentEventId: z.string().length(26),
  amount: z.number().positive(),
  reason: z.string().optional(),
});

/**
 * 환불 요청 DTO
 */
export class RefundRequestDto extends createZodDto(RefundRequestSchema) {}

/**
 * 환불 성공 스키마
 */
export const RefundSuccessSchema = z.object({
  paymentEventId: z.string().length(26),
  amount: z.number().positive(),
  reason: z.string().optional(),
});

/**
 * 환불 성공 DTO
 */
export class RefundSuccessDto extends createZodDto(RefundSuccessSchema) {}

/**
 * 환불 실패 스키마
 */
export const RefundFailureSchema = z.object({
  paymentEventId: z.string().length(26),
  amount: z.number().positive(),
  reason: z.string().optional(),
});

/**
 * 환불 실패 DTO
 */
export class RefundFailureDto extends createZodDto(RefundFailureSchema) {}