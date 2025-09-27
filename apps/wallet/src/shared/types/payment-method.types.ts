export type PaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'PARTIALLY_CAPTURED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'FAILED'
  | 'CANCELED';

export const normalizePaymentStatus = (s: string): PaymentStatus =>
  s === 'CANCELLED' ? 'CANCELED' : (s as PaymentStatus);
