// wallet.dto.ts
import { createZodDto } from 'nestjs-zod';
import * as schemas from './wallet.zod';

// =================================================================
// 🔵 컨트롤러/API 계층용 DTO 클래스 (Public API for Controllers)
// =================================================================

// --- PaymentMethod & CardMethod ---
// ────────────────────────────────────────────────────────────────
export class PaymentMethodDto extends createZodDto(
  schemas.PaymentMethodSchema,
) {}
export class CreatePaymentMethodDto extends createZodDto(
  schemas.CreatePaymentMethodPayloadSchema,
) {}
// 업데이트용: 모든 필드를 optional 로 허용
export class UpdatePaymentMethodDto extends createZodDto(
  schemas.CreatePaymentMethodPayloadSchema.partial(),
) {}
export class VerifyPaymentMethodDto extends createZodDto(
  schemas.VerifyPaymentMethodStatusSchema,
) {}
export class CardMethodDto extends createZodDto(schemas.CardMethodSchema) {}

// --- BNPL (Buy Now, Pay Later) ---
// ────────────────────────────────────────────────────────────────
export class BnplAccountDto extends createZodDto(schemas.BnplAccountSchema) {}
export class CreateBnplAccountDto extends createZodDto(
  schemas.CreateBnplAccountPayloadSchema,
) {}
export class UpdateBnplAccountStatusDto extends createZodDto(
  schemas.UpdateBnplAccountStatusPayloadSchema,
) {}
export class BnplActivationEventDto extends createZodDto(
  schemas.BnplActivationEventSchema,
) {}
export class BnplTransactionDto extends createZodDto(
  schemas.BnplTransactionSchema,
) {}

// --- Settlement ---
// ────────────────────────────────────────────────────────────────
export class SettlementBatchDto extends createZodDto(
  schemas.SettlementBatchSchema,
) {}
export class SettlementBatchItemDto extends createZodDto(
  schemas.SettlementBatchItemSchema,
) {}
export class SettlementProcessEventDto extends createZodDto(
  schemas.SettlementProcessEventSchema,
) {}

// --- Invoice ---
// ────────────────────────────────────────────────────────────────
export class InvoiceDto extends createZodDto(schemas.InvoiceSchema) {}
export class CreateInvoiceDto extends createZodDto(
  schemas.CreateInvoicePayloadSchema,
) {}
export class UpdateInvoiceStatusDto extends createZodDto(
  schemas.UpdateInvoiceStatusPayloadSchema,
) {}
export class InvoiceEventDto extends createZodDto(schemas.InvoiceEventSchema) {}
export class InvoiceWithEventsDto extends createZodDto(
  schemas.InvoiceWithEventsSchema,
) {}

// --- Payment & Refund Events ---
// ────────────────────────────────────────────────────────────────
export class PaymentEventDto extends createZodDto(schemas.PaymentEventSchema) {}
export class RefundEventDto extends createZodDto(schemas.RefundEventSchema) {}

// --- Core API Events ---
// ────────────────────────────────────────────────────────────────
export class PaymentRequestedEventDto extends createZodDto(
  schemas.PaymentRequestedEventSchema,
) {}
export class PaymentAuthorizedEventDto extends createZodDto(
  schemas.PaymentAuthorizedEventSchema,
) {}
export class PaymentCapturedEventDto extends createZodDto(
  schemas.PaymentCapturedEventSchema,
) {}
export class PaymentFailedEventDto extends createZodDto(
  schemas.PaymentFailedEventSchema,
) {}

// --- Custom Responses ---
export class CreateBnplAccountResponseDto extends createZodDto(
  schemas.CreateBnplAccountResponseSchema,
) {}
