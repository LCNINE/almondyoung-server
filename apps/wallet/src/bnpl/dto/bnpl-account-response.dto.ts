import { createZodDto,  } from 'nestjs-zod';
import { z } from 'zod';

/**
 * BNPL 계좌 응답 스키마
 */
export const BnplAccountResponseSchema = z.object({
  id: z.string(),
  userId: z.number().int(),
  creditLimit: z.number(),
  currentBalance: z.number(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'OVERDUE', 'SUSPENDED']),
  billingCycleDay: z.number().int(),
  version: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date()
});

/**
 * BNPL 계좌 응답 DTO
 */
export class BnplAccountResponseDto extends createZodDto(BnplAccountResponseSchema) {}