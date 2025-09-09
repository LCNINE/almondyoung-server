// providers/payment-provider.factory.ts

import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProvider,
  PaymentProvider_ID,
} from './payment-provider.interface';
import { HmsCardProvider } from './hms-card.provider';
import { HmsCmsProvider } from './hms-cms.provider';
import { HmsBnplProvider } from './hms-bnpl.provider';
import { TossProvider } from './toss.provider';
import { KakaopayProvider } from './kakaopay.provider';
import { PointsProvider } from './points.provider';

/**
 * Payment Provider Factory
 * - 정책 기반으로 적절한 Provider 인스턴스 반환
 * - 전략 패턴 구현의 핵심
 */
@Injectable()
export class PaymentProviderFactory {
  private readonly logger = new Logger(PaymentProviderFactory.name);
  private readonly providers = new Map<PaymentProvider_ID, PaymentProvider>();

  constructor(
    private readonly hmsCardProvider: HmsCardProvider,
    private readonly hmsCmsProvider: HmsCmsProvider,
    private readonly hmsBnplProvider: HmsBnplProvider,
    private readonly tossProvider: TossProvider,
    private readonly kakaopayProvider: KakaopayProvider,
    private readonly pointsProvider: PointsProvider,
  ) {
    this.initializeProviders();
  }

  /**
   * Provider 인스턴스 초기화
   */
  private initializeProviders(): void {
    this.providers.set('HMS_CARD', this.hmsCardProvider);
    this.providers.set('HMS_CMS', this.hmsCmsProvider);
    this.providers.set('HMS_BNPL', this.hmsBnplProvider);
    this.providers.set('TOSS', this.tossProvider);
    this.providers.set('KAKAOPAY', this.kakaopayProvider);
    this.providers.set('POINTS', this.pointsProvider);

    this.logger.log(
      `Payment Provider Factory 초기화 완료 - ${this.providers.size}개 Provider 등록`,
    );
  }

  /**
   * Provider ID로 Provider 인스턴스 반환
   */
  getProvider(providerId: PaymentProvider_ID): PaymentProvider {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error(`지원하지 않는 Provider: ${providerId}`);
    }

    return provider;
  }

  /**
   * 등록된 모든 Provider ID 목록 반환
   */
  getAvailableProviders(): PaymentProvider_ID[] {
    return Array.from(this.providers.keys());
  }

  /**
   * 특정 결제 타입을 지원하는 Provider들 반환
   */
  getProvidersForType(paymentType: string): PaymentProvider[] {
    return Array.from(this.providers.values()).filter((provider) =>
      provider.supportedTypes.includes(paymentType as any),
    );
  }
}
