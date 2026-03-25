import { DbService } from '@app/db';
import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import {
  WalletSchema,
  charges,
  outboxEvents,
  paymentIntentItemDiscounts,
  paymentIntentItems,
  paymentIntentOrderDiscounts,
  paymentIntents,
  paymentMethods,
  paymentStateTransitions,
  pointEventDetails,
  pointEvents,
  pointHoldDetails,
  pointHolds,
  providerWebhookReceipts,
  refunds,
} from './schema';

export type WalletDb = DbService<WalletSchema>['db'];
export type DbTx = Parameters<Parameters<WalletDb['transaction']>[0]>[0];
export type DbTransaction = DbTx;

export type PaymentMethod = InferSelectModel<typeof paymentMethods>;
export type NewPaymentMethod = InferInsertModel<typeof paymentMethods>;
export type UpdatePaymentMethod = Partial<Omit<NewPaymentMethod, 'id' | 'createdAt' | 'updatedAt'>>;

export type PaymentIntent = InferSelectModel<typeof paymentIntents>;
export type NewPaymentIntent = InferInsertModel<typeof paymentIntents>;
export type UpdatePaymentIntent = Partial<Omit<NewPaymentIntent, 'id' | 'createdAt' | 'updatedAt'>>;

export type PaymentIntentItem = InferSelectModel<typeof paymentIntentItems>;
export type NewPaymentIntentItem = InferInsertModel<typeof paymentIntentItems>;

export type PaymentIntentItemDiscount = InferSelectModel<typeof paymentIntentItemDiscounts>;
export type NewPaymentIntentItemDiscount = InferInsertModel<typeof paymentIntentItemDiscounts>;

export type PaymentIntentOrderDiscount = InferSelectModel<typeof paymentIntentOrderDiscounts>;
export type NewPaymentIntentOrderDiscount = InferInsertModel<typeof paymentIntentOrderDiscounts>;

export type Charge = InferSelectModel<typeof charges>;
export type NewCharge = InferInsertModel<typeof charges>;
export type UpdateCharge = Partial<Omit<NewCharge, 'id' | 'createdAt' | 'updatedAt'>>;

export type Refund = InferSelectModel<typeof refunds>;
export type NewRefund = InferInsertModel<typeof refunds>;
export type UpdateRefund = Partial<Omit<NewRefund, 'id' | 'createdAt' | 'updatedAt'>>;

export type PaymentStateTransition = InferSelectModel<typeof paymentStateTransitions>;
export type NewPaymentStateTransition = InferInsertModel<typeof paymentStateTransitions>;

export type OutboxEvent = InferSelectModel<typeof outboxEvents>;
export type NewOutboxEvent = InferInsertModel<typeof outboxEvents>;
export type UpdateOutboxEvent = Partial<Omit<NewOutboxEvent, 'id' | 'createdAt' | 'updatedAt'>>;

export type ProviderWebhookReceipt = InferSelectModel<typeof providerWebhookReceipts>;
export type NewProviderWebhookReceipt = InferInsertModel<typeof providerWebhookReceipts>;

export type PointEvent = InferSelectModel<typeof pointEvents>;
export type NewPointEvent = InferInsertModel<typeof pointEvents>;

export type PointEventDetail = InferSelectModel<typeof pointEventDetails>;
export type NewPointEventDetail = InferInsertModel<typeof pointEventDetails>;

export type PointHold = InferSelectModel<typeof pointHolds>;
export type NewPointHold = InferInsertModel<typeof pointHolds>;
export type UpdatePointHold = Partial<Omit<NewPointHold, 'id' | 'createdAt' | 'updatedAt'>>;

export type PointHoldDetail = InferSelectModel<typeof pointHoldDetails>;
export type NewPointHoldDetail = InferInsertModel<typeof pointHoldDetails>;
