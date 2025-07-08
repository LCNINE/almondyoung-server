import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ulid } from 'ulid';
import {
  PayRequest,
  PgPayResult,
  PaymentStrategy,
  RefundRequest,
  PgRefundResult,
} from './payment.strategy';
import { PgService } from '../pg.service';

@Injectable()
export class CardPaymentStrategy implements PaymentStrategy {
  constructor(private readonly pgService: PgService) {}

  async pay({ invoice }: PayRequest): Promise<PgPayResult> {
    return this.pgService.approvePayment({
      amount: Number(invoice.amount),
      userId: invoice.userId,
    });
  }

  async refund(request: RefundRequest): Promise<PgRefundResult> {
    const { paymentEventToRefund, amount } = request;
    const originalPaymentAmount = Number(paymentEventToRefund.amount);

    if (!paymentEventToRefund.pgTransactionId) {
      throw new InternalServerErrorException(
        'PG transaction ID is required for refund.',
      );
    }

    return this.pgService.refundPayment({
      pgTransactionId: paymentEventToRefund.pgTransactionId,
      amount,
      originalAmount: originalPaymentAmount,
    });
  }
} 