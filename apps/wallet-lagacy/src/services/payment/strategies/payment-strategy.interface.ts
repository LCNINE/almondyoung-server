// apps/wallet/src/services/payment/strategies/payment-strategy.interface.ts

import type { PaymentIntent } from '../../../shared/database/types';
import type { ProviderType } from '../../../providers/payment-provider.interface';

/**
 * 결제 전략 인터페이스
 * 
 * 결제 수단 타입(일회성 토큰 vs 저장된 프로필)에 따라
 * Payload 조립 로직을 분리
 */
export interface PaymentStrategy {
  /**
   * Provider별 Payload 조립
   * 
   * @param intent 결제 의도
   * @param providerType 결제 제공자
   * @param amount 결제 금액
   * @param options 전략별 옵션 (authParams 또는 profileId)
   * @param tx 트랜잭션
   * @returns Provider별 Payload
   */
  buildPayload(
    intent: PaymentIntent,
    providerType: ProviderType,
    amount: number,
    options: { authParams?: Record<string, string>; profileId?: string },
    tx: any,
  ): Promise<any>;
}

