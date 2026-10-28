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

export type PurchaseSatisfactionScoreFilter = 'all' | 'low' | 'high';

export interface PurchaseSatisfactionDto {
  id: string;
  orderId: string;
  orderDisplayId: number;
  userId: string;
  rating: number;
  reasons: PurchaseSatisfactionReason[];
  memo: string | null;
  checkedAt: string | null;
  checkedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseSatisfactionSummary {
  count: number;
  average: number;
  csatPercent: number;
  uncheckedLow: number;
  distribution: number[];
  reasonCounts: Record<PurchaseSatisfactionReason, number>;
}

export interface PurchaseSatisfactionListQuery {
  from?: string;
  to?: string;
  score?: PurchaseSatisfactionScoreFilter;
  reason?: PurchaseSatisfactionReason;
  hasMemo?: boolean;
  unchecked?: boolean;
  page?: number;
  limit?: number;
}

export interface PurchaseSatisfactionListResponse {
  summary: PurchaseSatisfactionSummary;
  data: PurchaseSatisfactionDto[];
  total: number;
  page: number;
  limit: number;
}
