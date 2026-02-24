import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentProvider } from './payment-provider.interface';
import { PointsPaymentProvider } from './points/points.provider';
import { TossPaymentProvider } from './toss/toss.provider';

@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(
    pointsProvider: PointsPaymentProvider,
    tossProvider: TossPaymentProvider,
  ) {
    this.register(pointsProvider);
    this.register(tossProvider);
  }

  all(): PaymentProvider[] {
    return Array.from(this.providers.values());
  }

  getProviderOrThrow(providerType: string): PaymentProvider {
    const normalizedType = providerType.trim().toUpperCase();
    const provider = this.providers.get(normalizedType);

    if (!provider) {
      throw new NotFoundException({
        error: 'PROVIDER_NOT_SUPPORTED',
        message: `Payment provider not supported: ${providerType}`,
      });
    }

    return provider;
  }

  private register(provider: PaymentProvider): void {
    this.providers.set(provider.providerType.toUpperCase(), provider);
  }
}
