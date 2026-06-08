import { DbService } from '@app/db';
import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import {
  WalletSchema,
  billingAgreements,
  billingMethods,
  charges,
  checkoutSessions,
  cmsAgreements,
  cmsMembers,
  cmsWithdrawals,
  outboxEvents,
  paymentIntentItemDiscounts,
  paymentIntentItems,
  paymentIntentOrderDiscounts,
  paymentIntents,
  paymentMethodCatalog,
  paymentMethods,
  paymentStateTransitions,
  regionPaymentMethods,
  regions,
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

export type PaymentMethodCatalog = InferSelectModel<typeof paymentMethodCatalog>;
export type NewPaymentMethodCatalog = InferInsertModel<typeof paymentMethodCatalog>;
export type UpdatePaymentMethodCatalog = Partial<Omit<NewPaymentMethodCatalog, 'id' | 'createdAt' | 'updatedAt'>>;

export type Region = InferSelectModel<typeof regions>;
export type NewRegion = InferInsertModel<typeof regions>;
export type UpdateRegion = Partial<Omit<NewRegion, 'id' | 'createdAt' | 'updatedAt'>>;

export type RegionPaymentMethod = InferSelectModel<typeof regionPaymentMethods>;
export type NewRegionPaymentMethod = InferInsertModel<typeof regionPaymentMethods>;
export type UpdateRegionPaymentMethod = Partial<Omit<NewRegionPaymentMethod, 'id' | 'createdAt' | 'updatedAt'>>;

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

export type BillingMethod = InferSelectModel<typeof billingMethods>;
export type NewBillingMethod = InferInsertModel<typeof billingMethods>;
export type UpdateBillingMethod = Partial<Omit<NewBillingMethod, 'id' | 'createdAt' | 'updatedAt'>>;

export type BillingAgreement = InferSelectModel<typeof billingAgreements>;
export type NewBillingAgreement = InferInsertModel<typeof billingAgreements>;
export type UpdateBillingAgreement = Partial<Omit<NewBillingAgreement, 'id' | 'createdAt' | 'updatedAt'>>;

export type CheckoutSession = InferSelectModel<typeof checkoutSessions>;
export type NewCheckoutSession = InferInsertModel<typeof checkoutSessions>;
export type UpdateCheckoutSession = Partial<Omit<NewCheckoutSession, 'id' | 'createdAt' | 'updatedAt'>>;

export type CmsMember = InferSelectModel<typeof cmsMembers>;
export type NewCmsMember = InferInsertModel<typeof cmsMembers>;
export type UpdateCmsMember = Partial<Omit<NewCmsMember, 'id' | 'createdAt' | 'updatedAt'>>;

export type CmsWithdrawal = InferSelectModel<typeof cmsWithdrawals>;
export type NewCmsWithdrawal = InferInsertModel<typeof cmsWithdrawals>;
export type UpdateCmsWithdrawal = Partial<Omit<NewCmsWithdrawal, 'id' | 'createdAt' | 'updatedAt'>>;

export type CmsAgreementRecord = InferSelectModel<typeof cmsAgreements>;
export type NewCmsAgreementRecord = InferInsertModel<typeof cmsAgreements>;
export type UpdateCmsAgreementRecord = Partial<Omit<NewCmsAgreementRecord, 'id' | 'createdAt' | 'updatedAt'>>;
