import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type { purchaseSatisfactions } from '../db/schema';

export const PURCHASE_SATISFACTION_REASONS = [
  'ADDRESS_INPUT',
  'COUPON_DISCOUNT',
  'CASH_RECEIPT',
  'PAYMENT_METHOD',
  'PAYMENT_ERROR',
  'PRODUCT_SEARCH',
  'OTHER',
] as const;

export type PurchaseSatisfactionReason = (typeof PURCHASE_SATISFACTION_REASONS)[number];

export type PurchaseSatisfactionRow = InferSelectModel<typeof purchaseSatisfactions>;
export type PurchaseSatisfactionInsert = InferInsertModel<typeof purchaseSatisfactions>;
