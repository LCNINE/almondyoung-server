// wallet.payload.ts
import { z } from 'zod';
import * as schemas from './wallet.zod';

// =================================================================
// 🔵 서비스 계층용 타입 (Public API for Services)
// =================================================================

// --- PaymentMethod & CardMethod ---
// ────────────────────────────────────────────────────────────────
export type PaymentMethod = z.infer<typeof schemas.PaymentMethodSchema>;
export type CreatePaymentMethodPayload = z.infer<
  typeof schemas.CreatePaymentMethodPayloadSchema
>;
export type CardMethod = z.infer<typeof schemas.CardMethodSchema>;

// --- BNPL (Buy Now, Pay Later) ---
// ────────────────────────────────────────────────────────────────
export type BnplAccount = z.infer<typeof schemas.BnplAccountSchema>;
export type CreateBnplAccountPayload = z.infer<
  typeof schemas.CreateBnplAccountPayloadSchema
>;
export type UpdateBnplAccountStatusPayload = z.infer<
  typeof schemas.UpdateBnplAccountStatusPayloadSchema
>;
export type BnplActivationEvent = z.infer<
  typeof schemas.BnplActivationEventSchema
>;
export type BnplTransaction = z.infer<typeof schemas.BnplTransactionSchema>;

// --- Settlement ---
// ────────────────────────────────────────────────────────────────
export type SettlementBatch = z.infer<typeof schemas.SettlementBatchSchema>;
export type SettlementBatchItem = z.infer<
  typeof schemas.SettlementBatchItemSchema
>;
export type SettlementProcessEvent = z.infer<
  typeof schemas.SettlementProcessEventSchema
>;
export type CreateSettlementProcessEventPayload = z.infer<
  typeof schemas.CreateSettlementProcessEventPayloadSchema
>;
export type SettlementBatchItemWithTransaction = z.infer<
  typeof schemas.SettlementBatchItemWithTransactionSchema
>;
// --- Invoice ---
// ────────────────────────────────────────────────────────────────
export type Invoice = z.infer<typeof schemas.InvoiceSchema>;
export type CreateInvoicePayload = z.infer<
  typeof schemas.CreateInvoicePayloadSchema
>;
export type UpdateInvoiceStatusPayload = z.infer<
  typeof schemas.UpdateInvoiceStatusPayloadSchema
>;
export type InvoiceEvent = z.infer<typeof schemas.InvoiceEventSchema>;
export type InvoiceWithEvents = z.infer<typeof schemas.InvoiceWithEventsSchema>;

// --- Payment & Refund Events ---
// ────────────────────────────────────────────────────────────────
export type PaymentEvent = z.infer<typeof schemas.PaymentEventSchema>;
export type RefundEvent = z.infer<typeof schemas.RefundEventSchema>;

export type CreatePaymentPayload = z.infer<
  typeof schemas.CreatePaymentPayloadSchema
>;
export type UpdatePaymentStatusPayload = z.infer<
  typeof schemas.UpdatePaymentStatusPayloadSchema
>;

export type RequestPaymentPayload = z.infer<
  typeof schemas.RequestPaymentPayloadSchema
>;
export type AuthorizePaymentPayload = z.infer<
  typeof schemas.AuthorizePaymentPayloadSchema
>;
export type CapturePaymentPayload = z.infer<
  typeof schemas.CapturePaymentPayloadSchema
>;
export type FailPaymentPayload = z.infer<
  typeof schemas.FailPaymentPayloadSchema
>;

// --- Core API Events ---
// ────────────────────────────────────────────────────────────────
export type PaymentRequestedEvent = z.infer<
  typeof schemas.PaymentRequestedEventSchema
>;
export type PaymentAuthorizedEvent = z.infer<
  typeof schemas.PaymentAuthorizedEventSchema
>;
export type PaymentCapturedEvent = z.infer<
  typeof schemas.PaymentCapturedEventSchema
>;
export type PaymentFailedEvent = z.infer<
  typeof schemas.PaymentFailedEventSchema
>;

export type CoreEvent =
  | PaymentRequestedEvent
  | PaymentAuthorizedEvent
  | PaymentCapturedEvent
  | PaymentFailedEvent;
