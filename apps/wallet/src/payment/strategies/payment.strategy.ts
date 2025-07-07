import type { PaymentTransactionRequest } from 'hms-api-wrapper';
import { paymentEvents } from '../schema';
import { invoice } from '../../invoice/schema';
import { paymentMethod } from '../../payment-method/schema';

export interface PayRequest {
  invoice: typeof invoice.$inferSelect;
  paymentMethod: typeof paymentMethod.$inferSelect;
}

export interface PgPayResult {
  success: boolean;
  pgTransactionId?: string;
  pgResponse: string;
}

export interface RefundRequest {
  paymentEventToRefund: typeof paymentEvents.$inferSelect;
  invoice: typeof invoice.$inferSelect;
  amount: number;
  reason?: string;
}

export interface PgRefundResult {
  success: boolean;
  pgTransactionId?: string;
  pgResponse: string;
}

export interface PaymentStrategy {
  pay(request: PayRequest): Promise<PgPayResult>;
  refund(request: RefundRequest): Promise<PgRefundResult>;
} 