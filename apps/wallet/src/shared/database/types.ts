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
  taxInvoiceSnapshots: schema.taxInvoiceSnapshots,
  userTaxInvoicePreferences: schema.userTaxInvoicePreferences,

  // Cash Receipt System
  cashReceiptEvents: schema.cashReceiptEvents,
  cashReceiptEventDetails: schema.cashReceiptEventDetails,
};

export type WalletSchema = typeof walletSchema;
export type DbTransaction = PostgresJsDatabase<WalletSchema>;

// ===============================
// Payment Intent 타입들
// ===============================

// DiscountLine 타입 (포인트 할인 정보)
export type DiscountLine = schema.DiscountLine;

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
export type UpdateTaxInvoice = Partial<
  Omit<NewTaxInvoice, 'id' | 'createdAt' | 'updatedAt'>
>;

export type TaxInvoiceEvent = InferSelectModel<typeof schema.taxInvoiceEvents>;
export type NewTaxInvoiceEvent = InferInsertModel<
  typeof schema.taxInvoiceEvents
>;

export type TaxInvoiceSnapshot = InferSelectModel<
  typeof schema.taxInvoiceSnapshots
>;
export type NewTaxInvoiceSnapshot = InferInsertModel<
  typeof schema.taxInvoiceSnapshots
>;

export type UserTaxInvoicePreference = InferSelectModel<
  typeof schema.userTaxInvoicePreferences
>;
export type NewUserTaxInvoicePreference = InferInsertModel<
  typeof schema.userTaxInvoicePreferences
>;
export type UpdateUserTaxInvoicePreference = Partial<
  Omit<NewUserTaxInvoicePreference, 'userId' | 'createdAt' | 'updatedAt'>
>;

/**
 * 세금계산서와 이벤트를 조인한 결과 타입
 */
export type TaxInvoiceWithEvents = TaxInvoice & {
  events: TaxInvoiceEvent[];
};

/**
 * 세금계산서와 스냅샷을 조인한 결과 타입
 */
export type TaxInvoiceWithSnapshot = TaxInvoice & {
  snapshot?: TaxInvoiceSnapshot;
};

// ===============================
// Tax Invoice 비즈니스 타입들
// ===============================

/**
 * 사업자 정보 (JSON 필드용)
 */
export type BusinessInfo = {
  name: string;
  businessNumber: string;
  address: string;
  ownerName: string;
  businessType?: string;
  businessItem?: string;
  email?: string;
};

/**
 * 세금계산서 스냅샷 페이로드 (홈택스 제출용 - 확장 버전)
 */
export type TaxInvoiceSnapshotPayload = {
  supplier: {
    businessNumber: string;
    name: string;
    ownerName: string;
    address: string;
    businessType?: string;
    businessItem?: string;
    email?: string;
  };
  buyer: {
    businessNumber: string;
    name: string;
    ownerName: string;
    address: string;
    businessType?: string;
    businessItem?: string;
    email?: string;
  };
  order: {
    orderId: string;
    orderNumber?: string;
    completedAt: string;
    status: 'COMPLETED' | 'CANCELLED' | 'REFUNDED';
    paymentMethod?: 'CASH' | 'CHECK' | 'NOTE' | 'CREDIT' | 'CARD';
    memo?: string;
    lines: Array<{
      productName: string;
      specification?: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    }>;
  };
  amounts: {
    supplyAmount: number;
    taxAmount: number;
    totalAmount: number;
    issueDate: string;
  };
};

/**
 * OMS → Wallet용 DTO (세금계산서 발행에 필요한 주문 데이터)
 */
export type TaxInvoiceOrderData = {
  orderId: string;
  userId: string;
  status: 'COMPLETED' | 'CANCELLED' | 'REFUNDED';
  completedAt: string;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  paymentMethod: 'CASH' | 'CHECK' | 'NOTE' | 'CREDIT' | 'CARD';
  lines: Array<{
    productName: string;
    specification?: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
  memo?: string;
};

/**
 * 홈택스 엑셀 Export용 응답 DTO
 */
export type HometaxExportRow = {
  // 내부 추적용
  taxInvoiceId: string;
  orderId: string;

  // 공급자 (우리 회사)
  supplierBusinessNumber: string;
  supplierName: string;
  supplierOwnerName: string;
  supplierAddress: string;
  supplierBusinessType?: string;
  supplierBusinessItem?: string;
  supplierEmail?: string;

  // 공급받는자 (고객)
  buyerBusinessNumber: string;
  buyerName: string;
  buyerOwnerName: string;
  buyerAddress: string;
  buyerBusinessType?: string;
  buyerBusinessItem?: string;
  buyerEmail?: string;

  // 거래 정보
  issueDate: string;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;

  // 품목 요약
  productSummary: string;

  // 비고
  remark?: string;

  // 결제수단
  paymentMethod?: string;
};

/**
 * 세금계산서 상태 타입
 */
export type TaxInvoiceStatus =
  | 'REQUESTED'
  | 'EXPORTED'
  | 'ISSUED_CONFIRMED'
  | 'FAILED'
  | 'CANCELLED'
  | 'NEEDS_MODIFICATION';

/**
 * 상태 전이 매트릭스
 */
export const TAX_INVOICE_TRANSITIONS: Record<
  TaxInvoiceStatus,
  TaxInvoiceStatus[]
> = {
  REQUESTED: ['EXPORTED', 'CANCELLED'],
  EXPORTED: ['ISSUED_CONFIRMED', 'FAILED'],
  ISSUED_CONFIRMED: ['NEEDS_MODIFICATION'],
  FAILED: ['REQUESTED'],
  CANCELLED: ['REQUESTED'],
  NEEDS_MODIFICATION: ['EXPORTED'],
};

// ===============================
// Cash Receipt 타입들
// ===============================
export type CashReceiptEvent = InferSelectModel<
  typeof schema.cashReceiptEvents
>;
export type NewCashReceiptEvent = InferInsertModel<
  typeof schema.cashReceiptEvents
>;
export type UpdateCashReceiptEvent = Partial<
  Omit<NewCashReceiptEvent, 'id' | 'createdAt'>
>;

export type CashReceiptEventDetail = InferSelectModel<
  typeof schema.cashReceiptEventDetails
>;
export type NewCashReceiptEventDetail = InferInsertModel<
  typeof schema.cashReceiptEventDetails
>;
export type UpdateCashReceiptEventDetail = Partial<
  Omit<NewCashReceiptEventDetail, 'id' | 'createdAt'>
>;

/**
 * 현금영수증 이벤트와 상세 정보를 조인한 결과 타입
 */
export type CashReceiptEventWithDetails = CashReceiptEvent & {
  details: CashReceiptEventDetail;
};
