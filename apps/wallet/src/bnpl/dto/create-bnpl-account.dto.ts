import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * BNPL 계좌 생성 스키마
 */
export const CreateBnplAccountSchema = z.object({
  methodType: z.literal('BNPL'),
  userId: z.string().min(1).max(64),
  methodName: z.string().min(1).max(64),
  isDefault: z.boolean().optional(),
  institutionCode: z.string().min(1).max(32),
  creditLimit: z.number().positive().optional(),
  approvedLimit: z.number().positive().optional(),
  billingCycleDay: z.number().int().min(1).max(31),
  termsUrl: z.string().url().optional(),
  phone: z
    .string()
    .regex(/^01[0-9]{8,9}$/)
    .optional(),
});

/**
 * BNPL 계좌 생성 DTO
 */
export class CreateBnplAccountDto extends createZodDto(
  CreateBnplAccountSchema,
) {}
