// apps/wallet/src/services/payment/strategies/payment-strategy.factory.ts

import { Injectable } from '@nestjs/common';
import { PaymentStrategy } from './payment-strategy.interface';
import { EphemeralPaymentStrategy } from './ephemeral-payment.strategy';
import { StoredProfilePaymentStrategy } from './stored-profile-payment.strategy';

/**
 * 결제 전략 팩토리
 * 
 * 옵션에 따라 적절한 전략 선택:
 * - authParams 존재 → EphemeralPaymentStrategy
 * - profileId 존재 → StoredProfilePaymentStrategy
 */
@Injectable()
export class PaymentStrategyFactory {
  constructor(
    private readonly ephemeralStrategy: EphemeralPaymentStrategy,
    private readonly storedProfileStrategy: StoredProfilePaymentStrategy,
  ) {}

  /**
   * 옵션에 따라 전략 선택
   * 
   * @param options authParams 또는 profileId 중 하나만 존재해야 함
   * @returns 선택된 PaymentStrategy
   */
  getStrategy(options: {
    authParams?: Record<string, string>;
    profileId?: string;
  }): PaymentStrategy {
    const hasAuthParams =
      !!options.authParams && Object.keys(options.authParams).length > 0;
    const hasProfileId = !!options.profileId;

    if (hasAuthParams && !hasProfileId) {
      return this.ephemeralStrategy;
    }

    if (hasProfileId && !hasAuthParams) {
      return this.storedProfileStrategy;
    }

    // XOR 검증: 둘 다 있거나 둘 다 없으면 에러
    throw new Error('Either authParams or profileId required, but not both');
  }
}

