import { Event as PaymentEvent } from '../../shared/zod/payment.zod';

export abstract class PaymentProcessingPort {
  abstract charge(request: PaymentEvent['Request']): Promise<any>;
  abstract refund(request: any): Promise<any>;
  abstract getPaymentStatus(transactionId: string): Promise<any>;
}
