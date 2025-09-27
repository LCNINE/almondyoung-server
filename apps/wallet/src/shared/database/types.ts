// apps/wallet/src/shared/database/types.ts
// Drizzle ORM 규칙에 따른 단일출처 타입 정의

import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

// ===============================
// 스키마 타입 정의
// ===============================
export const walletSchema = {
  // v2 Architecture Tables
  paymentIntents: schema.paymentIntents,
  paymentAttempts: schema.paymentAttempts,
  paymentRefunds: schema.paymentRefunds,
  checkoutSessions: schema.checkoutSessions,

  // Payment Profiles
  paymentProfiles: schema.paymentProfiles,
  cmsCardProfiles: schema.cmsCardProfiles,
  cmsBatchProfiles: schema.cmsBatchProfiles,

  // BNPL System
  bnplAccounts: schema.bnplAccounts,
  bnplEvents: schema.bnplEvents,

  // Refund System
  userRefundAccounts: schema.userRefundAccounts,

  // Point System
  pointEvents: schema.pointEvents,
  pointEventDetails: schema.pointEventDetails,

  // Utility Tables
  idempotencyKeys: schema.idempotencyKeys,

  // Tax Invoice System
  taxInvoices: schema.taxInvoices,
  taxInvoiceEvents: schema.taxInvoiceEvents,
  taxInvoiceEventsDetails: schema.taxInvoiceEventsDetails,
};

export type WalletSchema = typeof walletSchema;
export type DbTransaction = PostgresJsDatabase<WalletSchema>;

// ===============================
// Payment Intent 타입들
// ===============================
export type PaymentIntent = InferSelectModel<typeof schema.paymentIntents>;
export type NewPaymentIntent = InferInsertModel<typeof schema.paymentIntents>;
export type UpdatePaymentIntent = Partial<
  Omit<NewPaymentIntent, 'id' | 'createdAt' | 'updatedAt'>
>;

// ===============================
// Payment Attempt 타입들
// ===============================
export type PaymentAttempt = InferSelectModel<typeof schema.paymentAttempts>;
export type NewPaymentAttempt = InferInsertModel<typeof schema.paymentAttempts>;
export type UpdatePaymentAttempt = Partial<
  Omit<NewPaymentAttempt, 'id' | 'createdAt' | 'updatedAt'>
>;

// ===============================
// Payment Refund 타입들
// ===============================
export type PaymentRefund = InferSelectModel<typeof schema.paymentRefunds>;
export type NewPaymentRefund = InferInsertModel<typeof schema.paymentRefunds>;
export type UpdatePaymentRefund = Partial<
  Omit<NewPaymentRefund, 'id' | 'createdAt'>
>;

// ===============================
// Checkout Session 타입들
// ===============================
export type CheckoutSession = InferSelectModel<typeof schema.checkoutSessions>;
export type NewCheckoutSession = InferInsertModel<
  typeof schema.checkoutSessions
>;
export type UpdateCheckoutSession = Partial<
  Omit<NewCheckoutSession, 'id' | 'createdAt'>
>;

// ===============================
// Payment Profile 타입들
// ===============================
export type PaymentProfile = InferSelectModel<typeof schema.paymentProfiles>;
export type NewPaymentProfile = InferInsertModel<typeof schema.paymentProfiles>;
export type UpdatePaymentProfile = Partial<
  Omit<NewPaymentProfile, 'id' | 'createdAt' | 'updatedAt'>
>;

// CMS Card Profile
export type CmsCardProfile = InferSelectModel<typeof schema.cmsCardProfiles>;
export type NewCmsCardProfile = InferInsertModel<typeof schema.cmsCardProfiles>;
export type UpdateCmsCardProfile = Partial<
  Omit<NewCmsCardProfile, 'id' | 'createdAt' | 'updatedAt'>
>;

// CMS Batch Profile
export type CmsBatchProfile = InferSelectModel<typeof schema.cmsBatchProfiles>;
export type NewCmsBatchProfile = InferInsertModel<
  typeof schema.cmsBatchProfiles
>;
export type UpdateCmsBatchProfile = Partial<
  Omit<NewCmsBatchProfile, 'id' | 'createdAt' | 'updatedAt'>
>;

// ===============================
// BNPL 타입들
// ===============================
export type BnplAccount = InferSelectModel<typeof schema.bnplAccounts>;
export type NewBnplAccount = InferInsertModel<typeof schema.bnplAccounts>;
export type UpdateBnplAccount = Partial<
  Omit<NewBnplAccount, 'id' | 'createdAt' | 'updatedAt'>
>;

export type BnplEvent = InferSelectModel<typeof schema.bnplEvents>;
export type NewBnplEvent = InferInsertModel<typeof schema.bnplEvents>;
export type UpdateBnplEvent = Partial<
  Omit<NewBnplEvent, 'id' | 'createdAt' | 'updatedAt'>
>;

// ===============================
// Point System 타입들
// ===============================
export type PointEvent = InferSelectModel<typeof schema.pointEvents>;
export type NewPointEvent = InferInsertModel<typeof schema.pointEvents>;

export type PointEventDetail = InferSelectModel<
  typeof schema.pointEventDetails
>;
export type NewPointEventDetail = InferInsertModel<
  typeof schema.pointEventDetails
>;

// ===============================
// Refund Account 타입들
// ===============================
export type UserRefundAccount = InferSelectModel<
  typeof schema.userRefundAccounts
>;
export type NewUserRefundAccount = InferInsertModel<
  typeof schema.userRefundAccounts
>;
export type UpdateUserRefundAccount = Partial<
  Omit<NewUserRefundAccount, 'id' | 'createdAt' | 'updatedAt'>
>;

// ===============================
// Idempotency Key 타입들
// ===============================
export type IdempotencyKey = InferSelectModel<typeof schema.idempotencyKeys>;
export type NewIdempotencyKey = InferInsertModel<typeof schema.idempotencyKeys>;

// ===============================
// 비즈니스 로직용 복합 타입들
// ===============================

/**
 * Intent와 Attempt를 조인한 결과 타입
 */
export type IntentWithAttempts = PaymentIntent & {
  attempts: PaymentAttempt[];
};

/**
 * Profile과 CMS 정보를 조인한 결과 타입
 */
export type PaymentProfileWithDetails = PaymentProfile & {
  cmsCard?: CmsCardProfile;
  cmsBatch?: CmsBatchProfile;
};

/**
 * BNPL 계정과 이벤트를 조인한 결과 타입
 */
export type BnplAccountWithEvents = BnplAccount & {
  events: BnplEvent[];
};

/**
 * 환불과 계정 정보를 조인한 결과 타입
 */
export type RefundWithAccount = PaymentRefund & {
  refundAccount?: UserRefundAccount;
};

// ===============================
// Tax Invoice 타입들
// ===============================
export type TaxInvoice = InferSelectModel<typeof schema.taxInvoices>;
export type NewTaxInvoice = InferInsertModel<typeof schema.taxInvoices>;
export type UpdateTaxInvoice = Partial<Omit<NewTaxInvoice, 'id' | 'createdAt'>>;

export type TaxInvoiceEvent = InferSelectModel<typeof schema.taxInvoiceEvents>;
export type NewTaxInvoiceEvent = InferInsertModel<
  typeof schema.taxInvoiceEvents
>;

export type TaxInvoiceEventsDetail = InferSelectModel<
  typeof schema.taxInvoiceEventsDetails
>;
export type NewTaxInvoiceEventsDetail = InferInsertModel<
  typeof schema.taxInvoiceEventsDetails
>;
export type UpdateTaxInvoiceEventsDetail = Partial<
  Omit<NewTaxInvoiceEventsDetail, 'id' | 'createdAt' | 'updatedAt'>
>;

/**
 * 세금계산서와 상세 정보를 조인한 결과 타입
 */
export type TaxInvoiceWithDetails = TaxInvoice & {
  details: TaxInvoiceEventsDetail;
  events?: TaxInvoiceEvent[];
};
