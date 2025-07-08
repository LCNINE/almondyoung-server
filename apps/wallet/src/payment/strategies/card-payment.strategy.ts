import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  HmsAPI,
  PaymentCancelResponse,
  PaymentPartialCancelResponse,
  PaymentTransactionRequest,
} from 'hms-api-wrapper';
import { ulid } from 'ulid';
import {
  PayRequest,
  PgPayResult,
  PaymentStrategy,
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
      transactionId: `tx_${ulid()}`,
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

      if (amount < originalPaymentAmount) {
        refundResponse =
          await this.hmsApi.paymentTryansactions.cancelPartialTryansaction(
            pgTransactionId,
            amount,
          );
      } else {
        refundResponse =
          await this.hmsApi.paymentTryansactions.cancelTryansaction(
            pgTransactionId,
          );
      }

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