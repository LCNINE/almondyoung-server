import { Injectable } from '@nestjs/common';
import { PaymentProvider, ProviderOperation } from './payment-provider.types';
import {
  throwProviderCapabilityNotSupported,
  throwProviderNotSupported,
} from './provider.errors';
import { PointsPaymentProvider } from './points.provider';

@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(pointsProvider: PointsPaymentProvider) {
    this.register(pointsProvider);
  }

  getProviderOrThrow(providerType: string): PaymentProvider {
    const normalizedType = providerType.trim().toUpperCase();
    const provider = this.providers.get(normalizedType);

    if (!provider) {
      throwProviderNotSupported(providerType);
    }

    return provider;
  }

  assertCapability(
    providerType: string,
    operation: ProviderOperation,
    context?: { intentId: string; legId?: string },
  ): PaymentProvider {
    const provider = this.getProviderOrThrow(providerType);

    if (
      !provider.supports(operation, {
        intentId: context?.intentId ?? '',
        legId: context?.legId,
      })
    ) {
      throwProviderCapabilityNotSupported(provider.providerType, operation);
    }

    return provider;
  }

  private register(provider: PaymentProvider): void {
    this.providers.set(provider.providerType.toUpperCase(), provider);
  }
}
