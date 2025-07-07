import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HmsAPI } from 'hms-api-wrapper';
import type {
  PaymentTransactionRequest,
  PaymentCancelResponse,
  PaymentPartialCancelResponse,
} from 'hms-api-wrapper';
import {
  PaymentStrategy,
  PayRequest,
  PgPayResult,
  RefundRequest,
  PgRefundResult,
} from './payment.strategy';

@Injectable()
export class CardPaymentStrategy implements PaymentStrategy {
  constructor(private readonly hmsApi: HmsAPI) {}

  async pay({ invoice }: PayRequest): Promise<PgPayResult> {
    const pgRequest = this.buildPaymentRequest(invoice);

    try {
      const paymentResult =
        await this.hmsApi.paymentTryansactions.requestTryansaction(pgRequest);

      const success = paymentResult.payment?.result?.flag === 'Y';
      return {
        success,
        pgTransactionId: pgRequest.transactionId,
        pgResponse: JSON.stringify(paymentResult),
      };
    } catch (error) {
      return {
        success: false,
        pgTransactionId: pgRequest.transactionId,
        pgResponse: JSON.stringify(error.response || error.message),
      };
    }
  }

  private buildPaymentRequest(invoice: any): PaymentTransactionRequest {
    return {
      transactionId: `tx_${Date.now()}`,
      memberId: invoice.userId.toString(),
      callAmount: Number(invoice.amount),
      cardPointFlag: 'N',
    };
  }

  async refund(request: RefundRequest): Promise<PgRefundResult> {
    const { paymentEventToRefund, amount } = request;
    const originalPaymentAmount = Number(paymentEventToRefund.amount);

    if (!paymentEventToRefund.pgTransactionId) {
      throw new InternalServerErrorException(
        'PG transaction ID is required for refund.',
      );
    }
    const pgTransactionId = paymentEventToRefund.pgTransactionId;

    try {
      let refundResponse: PaymentCancelResponse | PaymentPartialCancelResponse;

      // Based on the provided type definition, we call different methods
      // for full and partial refunds.
      if (amount < originalPaymentAmount) {
        // Partial refund
        refundResponse =
          await this.hmsApi.paymentTryansactions.cancelPartialTryansaction(
            pgTransactionId,
            amount,
          );
      } else {
        // Full refund. The service layer prevents amount > originalPaymentAmount.
        refundResponse =
          await this.hmsApi.paymentTryansactions.cancelTryansaction(
            pgTransactionId,
          );
      }

      // We assume success if the API call does not throw an exception,
      // as we don't know the exact success flag in the response structure.
      return {
        success: true,
        pgTransactionId,
        pgResponse: JSON.stringify(refundResponse),
      };
    } catch (error) {
      return {
        success: false,
        pgTransactionId,
        pgResponse: JSON.stringify(error.response || error.message),
      };
    }
  }
} 