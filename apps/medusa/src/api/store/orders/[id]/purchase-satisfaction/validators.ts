import { z } from 'zod';

export const PURCHASE_SATISFACTION_REASONS = [
  'ADDRESS_INPUT',
  'COUPON_DISCOUNT',
  'CASH_RECEIPT',
  'PAYMENT_METHOD',
  'PAYMENT_ERROR',
  'PRODUCT_SEARCH',
  'OTHER',
] as const;

export const StorePurchaseSatisfactionWrite = z
  .object({
    rating: z.number().int().min(1).max(5),
    reasons: z.array(z.enum(PURCHASE_SATISFACTION_REASONS)).optional(),
    memo: z.string().max(300).optional(),
  })
  .strict();

export type StorePurchaseSatisfactionWriteType = z.infer<typeof StorePurchaseSatisfactionWrite>;
