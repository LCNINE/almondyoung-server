import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ====== 혜택 기록 요청 ======

export const RecordDiscountSchema = z.object({
  orderId: z.string(),
  userId: z.string(),
  orderDate: z.string().datetime(),
  membershipDiscountAmount: z.number().int().min(0),
  tierId: z.string().uuid(),
});

export class RecordDiscountDto extends createZodDto(RecordDiscountSchema) {}

// ====== 현재 주기 혜택 응답 ======

export const CycleBenefitSchema = z.object({
  userId: z.string(),
  cycleStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cycleEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalDiscountAmount: z.number().int().min(0),
  orderCount: z.number().int().min(0),
  daysRemaining: z.number().int(),
  daysElapsed: z.number().int(),
  subscriptionType: z.enum(['MONTHLY', 'ANNUAL']),
  nextCycleStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export class CycleBenefitDto extends createZodDto(CycleBenefitSchema) {}

// ====== 혜택 이력 응답 ======

export const CycleBenefitHistorySchema = z.object({
  userId: z.string(),
  cycles: z.array(
    z.object({
      cycleStartDate: z.string(),
      cycleEndDate: z.string(),
      totalDiscountAmount: z.number().int(),
      orderCount: z.number().int(),
      isCompleted: z.boolean(),
    }),
  ),
  totalCycles: z.number().int(),
  totalDiscountAllTime: z.number().int(),
});

export class CycleBenefitHistoryDto extends createZodDto(
  CycleBenefitHistorySchema,
) {}
