// apps/wallet/src/services/payment/strategies/stored-profile-payment.strategy.ts

import { Injectable, Logger } from '@nestjs/common';
import type { PaymentIntent } from '../../../shared/database/types';
import type { ProviderType } from '../../../providers/payment-provider.interface';
import { PaymentProfileService } from '../../profiles/payment-profile.service';
import { PaymentStrategy } from './payment-strategy.interface';

/**
 * 저장된 프로필 결제 전략 (Stored Profile Payment)
 * 
 * - 사용자가 미리 등록한 결제수단으로 결제
 * - profileId 필수
 * - HMS_CARD, HMS_BNPL 지원
 */
@Injectable()
export class StoredProfilePaymentStrategy implements PaymentStrategy {
  private readonly logger = new Logger(StoredProfilePaymentStrategy.name);

  constructor(private readonly profileService: PaymentProfileService) {}

  async buildPayload(
    intent: PaymentIntent,
    providerType: ProviderType,
    amount: number,
    options: { authParams?: Record<string, string>; profileId?: string },
    tx: any,
  ): Promise<any> {
    const { profileId } = options;

    if (!profileId) {
      throw new Error('profileId required for stored profile payment');
    }

    this.logger.log(
      `Building stored profile payload for ${providerType}, profile: ${profileId}`,
    );

    // PaymentProfileService를 통해 프로필 기반 Payload 조립
    return this.profileService.resolvePayload(profileId, providerType, amount, {
      tx,
    });
  }
}

