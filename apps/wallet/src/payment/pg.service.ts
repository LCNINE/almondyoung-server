import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  HmsAPI,
  PaymentTransactionRequest,
  PaymentCancelResponse,
  PaymentPartialCancelResponse,
} from 'hms-api-wrapper';
import { ulid } from 'ulid';

export interface ApprovePaymentParams {
  amount: number;
  userId: number;
}

export interface PgApproveResponse {
  success: boolean;
  pgTransactionId: string;
  pgResponse: string;
}

export interface RefundPaymentParams {
  pgTransactionId: string;
  amount: number;
  originalAmount: number;
}

export interface PgRefundResponse {
  success: boolean;
  pgTransactionId: string;
  pgResponse: string;
}

@Injectable()
export class PgService {
  constructor(private readonly hmsApi: HmsAPI) {}

  async approvePayment(params: ApprovePaymentParams): Promise<PgApproveResponse> {
    const pgRequest = this.buildPaymentRequest(params);

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

  private buildPaymentRequest(
    params: ApprovePaymentParams,
  ): PaymentTransactionRequest {
    return {
      transactionId: `tx_${ulid()}`,
      memberId: params.userId.toString(),
      callAmount: params.amount,
      cardPointFlag: 'N',
    };
  }

  async refundPayment(params: RefundPaymentParams): Promise<PgRefundResponse> {
    const { pgTransactionId, amount, originalAmount } = params;

    if (!pgTransactionId) {
      throw new InternalServerErrorException(
        'PG transaction ID is required for refund.',
      );
    }

    try {
      let refundResponse: PaymentCancelResponse | PaymentPartialCancelResponse;

      if (amount < originalAmount) {
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