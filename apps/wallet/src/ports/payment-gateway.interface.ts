export interface PaymentGatewayPort {
  authorize(request: GatewayRequest): Promise<GatewayResponse>;
  capture(transactionId: string, amount: number): Promise<GatewayResponse>;
  cancel(transactionId: string, reason: string): Promise<GatewayResponse>;
}

export interface GatewayRequest {
  amount: number;
  paymentKey?: string;
  metadata?: Record<string, any>;
}

export interface GatewayResponse {
  transactionId: string;
  status: 'success' | 'failed';
  data?: any;
}
