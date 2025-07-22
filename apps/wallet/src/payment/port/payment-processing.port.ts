export interface ChargeResult {
  success: boolean;
  transactionId: string; // PG사가 발급한 거래 ID
  // ✅ API 호출 직후의 상태 (예약 접수 완료)
  status: 'AUTHORIZED' | 'FAILED';
  rawResponse: any;
  gatewayId?: string; // 추후 필요
}

export interface ErrorResult {
  success: false;
  error: string;
}

export abstract class PaymentProcessingPort {
  abstract charge(request: {
    memberId: string;
    invoiceId: string;
    amount: number;
    paymentDate: string;
  }): Promise<ChargeResult | ErrorResult>;
  abstract refund(request: any): Promise<any>;
  abstract getPaymentStatus(transactionId: string): Promise<any>;
}
