// apps/wallet/src/services/payment/strategies/ephemeral-payment.strategy.ts

import { Injectable, Logger } from '@nestjs/common';
import type { PaymentIntent } from '../../../shared/database/types';
import type { ProviderType } from '../../../providers/payment-provider.interface';
import { PaymentStrategy } from './payment-strategy.interface';

/**
 * 일회성 토큰 결제 전략 (Ephemeral Payment)
 * 
 * - PG 리다이렉트 후 받은 토큰으로 결제
 * - authParams에 PG별 인증 파라미터 포함
 * - 현재 TOSS만 지원
 */
@Injectable()
export class EphemeralPaymentStrategy implements PaymentStrategy {
  private readonly logger = new Logger(EphemeralPaymentStrategy.name);

  async buildPayload(
    intent: PaymentIntent,
    providerType: ProviderType,
    amount: number,
    options: { authParams?: Record<string, string>; profileId?: string },
    tx: any,
  ): Promise<any> {
    const { authParams } = options;

    if (!authParams || Object.keys(authParams).length === 0) {
      throw new Error('authParams required for ephemeral payment');
    }

    this.logger.log(
      `Building ephemeral payload for ${providerType}, intent: ${intent.id}`,
    );

    switch (providerType) {
      case 'TOSS':
        return this.buildTossPayload(intent, amount, authParams);

      default:
        throw new Error(
          `Ephemeral payment not supported for provider: ${providerType}`,
        );
    }
  }

  /**
   * Toss Payments Payload 조립
   * 
   * @param intent 결제 의도
   * @param amount 결제 금액
   * @param authParams 인증 파라미터 (paymentKey 포함)
   * @returns TossPayload
   */
  private buildTossPayload(
    intent: PaymentIntent,
    amount: number,
    authParams: Record<string, string>,
  ): any {
    const { paymentKey } = authParams;

    if (!paymentKey) {
      throw new Error('paymentKey required for Toss payment');
    }

    this.logger.log(
      `Toss payload built: orderId=${intent.id}, amount=${amount}`,
    );

    return {
      amount,
      oneTimeToken: paymentKey, // paymentKey → oneTimeToken 매핑
      metadata: {
        intentId: intent.id,
      },
    };
  }
}

