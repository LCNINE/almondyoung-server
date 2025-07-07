import { invoice as invoiceSchema, invoiceEvent } from '../../invoice/schema';
import { paymentEvents as paymentEventsSchema, refundEvents as refundEventsSchema } from '../schema';

type Invoice = typeof invoiceSchema.$inferSelect;
type PaymentEvent = typeof paymentEventsSchema.$inferSelect;
type RefundEvent = typeof refundEventsSchema.$inferSelect;

export class PaymentSucceededEvent {
  constructor(
    public readonly invoice: Invoice,
    public readonly paymentEvent: PaymentEvent,
  ) {}
}

export class PaymentFailedEvent {
  constructor(
    public readonly invoice: Invoice,
    public readonly paymentEvent: PaymentEvent,
  ) {}
}

export class DuplicatePaymentAttemptedEvent {
  constructor(public readonly invoice: Invoice) {}
}

export class RefundSucceededEvent {
  constructor(
    public readonly invoice: Invoice,
    public readonly paymentEvent: PaymentEvent,
    public readonly refundEvent: RefundEvent,
  ) {}
}

export class RefundFailedEvent {
  constructor(
    public readonly invoice: Invoice,
    public readonly paymentEvent: PaymentEvent,
    public readonly requestedAmount: number,
    public readonly reason?: string,
  ) {}
} 