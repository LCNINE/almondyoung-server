import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PaymentProvider } from './payment-provider.interface';
import { PointsPaymentProvider } from './points/points.provider';
import { TossPaymentProvider } from './toss/toss.provider';
import { BankTransferPaymentProvider } from './bank-transfer/bank-transfer.provider';
import { CmsBatchProvider } from '../cms/cms-batch.provider';

export type ProviderKind = 'gateway' | 'ledger';

interface ProviderMeta {
  kind: ProviderKind;
}

@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();
  private readonly metadata = new Map<string, ProviderMeta>();

  constructor(
    pointsProvider: PointsPaymentProvider,
    tossProvider: TossPaymentProvider,
    bankTransferProvider: BankTransferPaymentProvider,
    @Optional() cmsBatchProvider?: CmsBatchProvider,
  ) {
    this.register(pointsProvider, { kind: 'ledger' });
    this.register(tossProvider, { kind: 'gateway' });
    this.register(bankTransferProvider, { kind: 'gateway' });
    if (cmsBatchProvider) {
      this.register(cmsBatchProvider, { kind: 'gateway' });
    }
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

  getKind(providerType: string): ProviderKind {
    const normalizedType = providerType.trim().toUpperCase();
    const meta = this.metadata.get(normalizedType);
    if (!meta) {
      throw new NotFoundException({
        error: 'PROVIDER_NOT_SUPPORTED',
        message: `Payment provider not supported: ${providerType}`,
      });
    }
    return meta.kind;
  }

  shouldAutoCapture(providerTypes: string[]): boolean {
    if (providerTypes.length === 0) return false;
    return providerTypes.every((type) => {
      const provider = this.providers.get(type.trim().toUpperCase());
      return provider?.autoCapture === true;
    });
  }

  register(provider: PaymentProvider, meta: ProviderMeta): void {
    const key = provider.providerType.toUpperCase();
    this.providers.set(key, provider);
    this.metadata.set(key, meta);
  }
}
