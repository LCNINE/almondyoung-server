import { DbService } from '@app/db';
import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import {
  WalletSchema,
  manualCancelQueueItems,
  outboxEvents,
  paymentAttempts,
  paymentIntentItemDiscounts,
  paymentIntentItems,
  paymentIntentOrderDiscounts,
  paymentIntents,
  paymentLegs,
  paymentStateTransitions,
  pointEventDetails,
  pointEvents,
  pointHoldDetails,
  pointHolds,
  providerWebhookReceipts,
  refundAllocations,
  refundRequests,
} from './schema';

export type WalletDb = DbService<WalletSchema>['db'];
export type DbTx = Parameters<Parameters<WalletDb['transaction']>[0]>[0];
export type DbTransaction = DbTx;

export type PaymentIntent = InferSelectModel<typeof paymentIntents>;
export type NewPaymentIntent = InferInsertModel<typeof paymentIntents>;
export type UpdatePaymentIntent = Partial<
  Omit<NewPaymentIntent, 'id' | 'createdAt' | 'updatedAt'>
>;

export type PaymentIntentItem = InferSelectModel<typeof paymentIntentItems>;
export type NewPaymentIntentItem = InferInsertModel<typeof paymentIntentItems>;
export type UpdatePaymentIntentItem = Partial<
  Omit<NewPaymentIntentItem, 'id' | 'createdAt' | 'updatedAt'>
>;

export type PaymentIntentItemDiscount = InferSelectModel<
  typeof paymentIntentItemDiscounts
>;
export type NewPaymentIntentItemDiscount = InferInsertModel<
  typeof paymentIntentItemDiscounts
>;
export type UpdatePaymentIntentItemDiscount = Partial<
  Omit<NewPaymentIntentItemDiscount, 'id' | 'createdAt' | 'updatedAt'>
>;

export type PaymentIntentOrderDiscount = InferSelectModel<
  typeof paymentIntentOrderDiscounts
>;
export type NewPaymentIntentOrderDiscount = InferInsertModel<
  typeof paymentIntentOrderDiscounts
>;
export type UpdatePaymentIntentOrderDiscount = Partial<
  Omit<NewPaymentIntentOrderDiscount, 'id' | 'createdAt' | 'updatedAt'>
>;

export type PaymentLeg = InferSelectModel<typeof paymentLegs>;
export type NewPaymentLeg = InferInsertModel<typeof paymentLegs>;
export type UpdatePaymentLeg = Partial<
  Omit<NewPaymentLeg, 'id' | 'createdAt' | 'updatedAt'>
>;

export type PaymentAttempt = InferSelectModel<typeof paymentAttempts>;
export type NewPaymentAttempt = InferInsertModel<typeof paymentAttempts>;
export type UpdatePaymentAttempt = Partial<
  Omit<NewPaymentAttempt, 'id' | 'createdAt' | 'updatedAt'>
>;

export type RefundRequest = InferSelectModel<typeof refundRequests>;
export type NewRefundRequest = InferInsertModel<typeof refundRequests>;
export type UpdateRefundRequest = Partial<
  Omit<NewRefundRequest, 'id' | 'createdAt' | 'updatedAt'>
>;

export type RefundAllocation = InferSelectModel<typeof refundAllocations>;
export type NewRefundAllocation = InferInsertModel<typeof refundAllocations>;
export type UpdateRefundAllocation = Partial<
  Omit<NewRefundAllocation, 'id' | 'createdAt'>
>;

export type ManualCancelQueueItem = InferSelectModel<typeof manualCancelQueueItems>;
export type NewManualCancelQueueItem = InferInsertModel<typeof manualCancelQueueItems>;
export type UpdateManualCancelQueueItem = Partial<
  Omit<NewManualCancelQueueItem, 'id' | 'createdAt' | 'updatedAt'>
>;

export type PointEvent = InferSelectModel<typeof pointEvents>;
export type NewPointEvent = InferInsertModel<typeof pointEvents>;
export type UpdatePointEvent = Partial<Omit<NewPointEvent, 'id' | 'createdAt'>>;

export type PointEventDetail = InferSelectModel<typeof pointEventDetails>;
export type NewPointEventDetail = InferInsertModel<typeof pointEventDetails>;

export type PointHold = InferSelectModel<typeof pointHolds>;
export type NewPointHold = InferInsertModel<typeof pointHolds>;
export type UpdatePointHold = Partial<Omit<NewPointHold, 'id' | 'createdAt' | 'updatedAt'>>;

export type PointHoldDetail = InferSelectModel<typeof pointHoldDetails>;
export type NewPointHoldDetail = InferInsertModel<typeof pointHoldDetails>;

export type PaymentStateTransition = InferSelectModel<typeof paymentStateTransitions>;
export type NewPaymentStateTransition = InferInsertModel<typeof paymentStateTransitions>;

export type OutboxEvent = InferSelectModel<typeof outboxEvents>;
export type NewOutboxEvent = InferInsertModel<typeof outboxEvents>;
export type UpdateOutboxEvent = Partial<
  Omit<NewOutboxEvent, 'id' | 'createdAt' | 'updatedAt'>
>;

export type ProviderWebhookReceipt = InferSelectModel<typeof providerWebhookReceipts>;
export type NewProviderWebhookReceipt = InferInsertModel<typeof providerWebhookReceipts>;
export type UpdateProviderWebhookReceipt = Partial<
  Omit<NewProviderWebhookReceipt, 'id' | 'createdAt' | 'updatedAt'>
>;
