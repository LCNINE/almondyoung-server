import type {
  manualCancelQueueItems,
  paymentAttempts,
  paymentIntentItemDiscounts,
  paymentIntentItems,
  paymentIntentOrderDiscounts,
  paymentIntents,
  paymentLegs,
  paymentStateTransitions,
  refundAllocations,
  refundRequests,
} from "@/db/drizzle/schema";

export type PaymentIntentRow = typeof paymentIntents.$inferSelect;
export type PaymentIntentItemRow = typeof paymentIntentItems.$inferSelect;
export type PaymentIntentItemDiscountRow =
  typeof paymentIntentItemDiscounts.$inferSelect;
export type PaymentIntentOrderDiscountRow =
  typeof paymentIntentOrderDiscounts.$inferSelect;
export type PaymentLegRow = typeof paymentLegs.$inferSelect;
export type PaymentAttemptRow = typeof paymentAttempts.$inferSelect;
export type RefundRequestRow = typeof refundRequests.$inferSelect;
export type RefundAllocationRow = typeof refundAllocations.$inferSelect;
export type ManualQueueItemRow = typeof manualCancelQueueItems.$inferSelect;
export type PaymentStateTransitionRow = typeof paymentStateTransitions.$inferSelect;

export interface IntentTransitionBundle {
  intent: PaymentStateTransitionRow[];
  leg: Record<string, PaymentStateTransitionRow[]>;
  attempt: Record<string, PaymentStateTransitionRow[]>;
  refundRequest: Record<string, PaymentStateTransitionRow[]>;
}

export interface IntentBundle {
  intent: PaymentIntentRow;
  items: PaymentIntentItemRow[];
  itemDiscounts: PaymentIntentItemDiscountRow[];
  orderDiscounts: PaymentIntentOrderDiscountRow[];
  legs: PaymentLegRow[];
  attempts: PaymentAttemptRow[];
  refundRequests: RefundRequestRow[];
  refundAllocations: RefundAllocationRow[];
  manualQueueItems: ManualQueueItemRow[];
  transitions: IntentTransitionBundle | null;
}

export interface WalletDevFilters {
  intentId: string | null;
  referenceId: string | null;
  status: string | null;
  limit: number;
  withTransitions: boolean;
}

export interface WalletDevIntentsResponse {
  fetchedAt: string;
  count: number;
  filters: WalletDevFilters;
  intents: IntentBundle[];
}
