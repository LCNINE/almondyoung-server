import { Injectable } from '@nestjs/common';
import type { 
  PaymentTransactionRequest, 
  PaymentApprovalResponse,
  PaymentResult,
  BasePaymentResponse
} from 'hms-api-wrapper';

interface ProcessPaymentParams {
  amount: number;
  billingKey: string;
  memberId: string;  // HMS API requires memberId
}

interface PgResponse {
  transactionId: string;
  status: 'success' | 'failed';
  message?: string;
  rawResponse?: BasePaymentResponse;
}

@Injectable()
export class PgService {
  async processPayment(params: ProcessPaymentParams): Promise<PgResponse> {
    try {
      const request: PaymentTransactionRequest = {
        transactionId: `tx_${Date.now()}`, // 고유한 거래 ID 생성
        memberId: params.memberId,
        callAmount: params.amount,
        cardPointFlag: 'N',  // 카드 포인트 사용하지 않음
      };

      // HMS API를 통한 결제 처리 - PaymentMethodService에서 처리
      throw new Error('Not implemented - Should be handled by PaymentMethodService');

    } catch (error) {
      return {
        transactionId: '', // 실패 시에는 빈 문자열
        status: 'failed',
        message: error.message,
        rawResponse: error.response?.payment,
      };
    }
  }
} 