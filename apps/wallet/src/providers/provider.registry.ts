import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PaymentProvider } from './payment-provider.interface';
import { PointsPaymentProvider } from './points/points.provider';
import { TossPaymentProvider } from './toss/toss.provider';
import { BankTransferPaymentProvider } from './bank-transfer/bank-transfer.provider';
import { CmsBatchProvider } from '../cms/cms-batch.provider';
import { PAYMENT_PROVIDER_DESCRIPTORS, PaymentProviderDescriptor, ProviderKind } from './provider-descriptors';

@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();
  private readonly descriptors = new Map<string, PaymentProviderDescriptor>();

  constructor(
    pointsProvider: PointsPaymentProvider,
    tossProvider: TossPaymentProvider,
    bankTransferProvider: BankTransferPaymentProvider,
    @Optional() cmsBatchProvider?: CmsBatchProvider,
  ) {
    this.register(pointsProvider, PAYMENT_PROVIDER_DESCRIPTORS.POINTS);
    this.register(tossProvider, PAYMENT_PROVIDER_DESCRIPTORS.TOSS);
    this.register(bankTransferProvider, PAYMENT_PROVIDER_DESCRIPTORS.BANK_TRANSFER);
    if (cmsBatchProvider) {
      this.register(cmsBatchProvider, PAYMENT_PROVIDER_DESCRIPTORS.CMS_BATCH);
    }
  }

  all(): PaymentProvider[] {
    return Array.from(this.providers.values());
  }

  listDescriptors(): PaymentProviderDescriptor[] {
    return Array.from(this.descriptors.values()).sort(
      (a, b) => a.defaultSortOrder - b.defaultSortOrder || a.code.localeCompare(b.code),
    );
  }

  hasProvider(providerType: string): boolean {
    return this.providers.has(providerType.trim().toUpperCase());
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

  getDescriptorOrThrow(providerType: string): PaymentProviderDescriptor {
    const normalizedType = providerType.trim().toUpperCase();
    const descriptor = this.descriptors.get(normalizedType);
    if (!descriptor) {
      throw new NotFoundException({
        error: 'PROVIDER_NOT_SUPPORTED',
        message: `Payment provider not supported: ${providerType}`,
      });
    }
    return descriptor;
  }

  getKind(providerType: string): ProviderKind {
    return this.getDescriptorOrThrow(providerType).kind;
  }

  shouldAutoCapture(providerTypes: string[]): boolean {
    if (providerTypes.length === 0) return false;
    return providerTypes.every((type) => {
      const provider = this.providers.get(type.trim().toUpperCase());
      return provider?.autoCapture === true;
    });
  }

  register(provider: PaymentProvider, descriptor: PaymentProviderDescriptor): void {
    const key = provider.providerType.toUpperCase();
    if (descriptor.code !== key) {
      throw new Error(`Provider descriptor code mismatch: ${descriptor.code} !== ${key}`);
    }
    this.providers.set(key, provider);
    this.descriptors.set(key, descriptor);
  }
}
