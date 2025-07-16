import { createZodDto, ZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * BNPL 계좌 비활성화 요청자 타입
 */
export enum BnplActor {
  USER = 'USER',
  ADMIN = 'ADMIN',
  SYSTEM = 'SYSTEM',
}

/**
 * BNPL 계좌 비활성화 스키마
 */
export const DeactivateBnplAccountSchema = z.object({
  actor: z.enum(['USER', 'ADMIN', 'SYSTEM']),
  accountId: z.string().optional()
});

/**
 * BNPL 계좌 비활성화 DTO
 */
export class DeactivateBnplAccountDto extends createZodDto(DeactivateBnplAccountSchema) {}