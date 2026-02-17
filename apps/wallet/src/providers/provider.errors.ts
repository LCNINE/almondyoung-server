import { BadRequestException } from '@nestjs/common';
import { ProviderOperation } from './payment-provider.types';

export function throwProviderNotSupported(providerType: string): never {
  throw new BadRequestException({
    error: 'PROVIDER_NOT_SUPPORTED',
    message: `Provider is not supported: ${providerType}`,
  });
}

export function throwProviderCapabilityNotSupported(
  providerType: string,
  operation: ProviderOperation,
): never {
  throw new BadRequestException({
    error: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
    message: `Provider ${providerType} does not support ${operation}`,
  });
}
