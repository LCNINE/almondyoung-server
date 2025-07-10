import { paymentEvents, refundEvents } from '../schema';

type RefundEvent = typeof refundEvents.$inferSelect;
type PaymentEvent = typeof paymentEvents.$inferSelect;

export type RefundWithPaymentDetails = RefundEvent & {
  payment?: {
    amount: PaymentEvent['amount'];
    createdAt: PaymentEvent['createdAt'];
    paymentMethodId: PaymentEvent['paymentMethodId'];
    invoiceId: PaymentEvent['invoiceId'];
  };
};

export type PaymentEventRow = typeof paymentEvents.$inferSelect;
export type RefundEventRow = typeof refundEvents.$inferSelect;
