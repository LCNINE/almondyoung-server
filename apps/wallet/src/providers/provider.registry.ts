import { Injectable } from '@nestjs/common';
import {
  PaymentProvider,
  PollablePaymentProvider,
  ProviderCapability,
} from './payment-provider.types';
import {
  throwProviderCapabilityNotSupported,
  throwProviderNotSupported,
} from './provider.errors';
import { PointsPaymentProvider } from './points/points.provider';

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
    capability: ProviderCapability,
    context?: { intentId: string; legId?: string },
  ): PaymentProvider {
    const provider = this.getProviderOrThrow(providerType);

    if (
      !provider.supports(capability, {
        intentId: context?.intentId ?? '',
        legId: context?.legId,
      })
    ) {
      throwProviderCapabilityNotSupported(provider.providerType, capability);
    }

    return provider;
  }

  assertPollStatusCapability(
    providerType: string,
    context?: { intentId: string; legId?: string },
  ): PollablePaymentProvider {
    const provider = this.assertCapability(providerType, 'POLL_STATUS', context);
    if (!isPollableProvider(provider)) {
      throwProviderCapabilityNotSupported(provider.providerType, 'POLL_STATUS');
    }
    return provider;
  }

  private register(provider: PaymentProvider): void {
    this.providers.set(provider.providerType.toUpperCase(), provider);
  }
}

function isPollableProvider(
  provider: PaymentProvider,
): provider is PollablePaymentProvider {
  return (
    typeof (
      provider as PollablePaymentProvider & {
        getTransaction?: unknown;
      }
    ).getTransaction === 'function'
  );
}
