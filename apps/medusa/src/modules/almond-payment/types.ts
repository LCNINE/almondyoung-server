export interface AlmondPaymentOptions {
  walletBaseUrl: string; // e.g. 'http://localhost:3100'
  walletApiKey: string;  // e.g. 'dev-secret'
}

// session.data에 저장되는 구조
export interface WalletSessionData {
  intentId: string;
  amount: number;
  currency: string;
  userId: string;
  medusaSessionId?: string; // Medusa payment session ID (for webhook correlation)
  captured?: boolean;       // true after capturePayment succeeds
}
