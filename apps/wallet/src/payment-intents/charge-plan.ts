import { PaymentProvider } from '../providers/payment-provider.interface';

export interface ChargeSlot {
  provider: PaymentProvider;
  paymentMethodId: string;
  amount: number;
}

/**
 * discount: ledger(Points)만 허용. 항상 동기(SUCCEEDED/FAILED).
 * primary: 어떤 Provider든 가능 (gateway 또는 ledger).
 *
 * 빌링(Kafka command 경유 자동 정기결제)은 discount 불가, primary만.
 * 포인트 전액결제는 discount 없이 primary에 Points 배치.
 */
export interface ChargePlan {
  discount?: ChargeSlot;
  primary: ChargeSlot;
}
