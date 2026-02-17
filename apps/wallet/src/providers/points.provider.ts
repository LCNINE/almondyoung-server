import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CapabilityContext,
  PaymentProvider,
  ProviderCapability,
  ProviderOperation,
  ProviderOperationRequest,
  ProviderOperationResult,
  ProviderTransactionSnapshot,
  ValidateLegRequest,
} from './payment-provider.types';
import { throwProviderCapabilityNotSupported } from './provider.errors';

const POINTS_CAPABILITIES: ProviderCapability[] = [
  'AUTHORIZE',
  'CAPTURE',
  'CANCEL',
  'REFUND',
  'PARTIAL_REFUND',
  'POLL_STATUS',
  'AUTO_COMPENSATE',
];

@Injectable()
export class PointsPaymentProvider implements PaymentProvider {
  readonly providerType = 'POINTS';
  readonly version = 'v1';

  getStaticCapabilities(): ProviderCapability[] {
    return POINTS_CAPABILITIES;
  }

  resolveRuntimeCapabilities(_ctx: CapabilityContext): ProviderCapability[] {
    return POINTS_CAPABILITIES;
  }

  supports(operation: ProviderOperation, ctx?: CapabilityContext): boolean {
    const capabilities = this.resolveRuntimeCapabilities(
      ctx ?? {
        intentId: '',
      },
    );
    return capabilities.includes(operation);
  }

  async validateLeg(req: ValidateLegRequest): Promise<void> {
    if (req.amount <= 0) {
      throw new BadRequestException({
        error: 'LEG_AMOUNT_INVALID',
        message: 'Leg amount must be greater than zero',
      });
    }

    if (req.currency.toUpperCase() !== 'KRW') {
      throw new BadRequestException({
        error: 'POINTS_CURRENCY_NOT_SUPPORTED',
        message: `POINTS provider supports KRW only: ${req.currency}`,
      });
    }
  }

  async authorize(req: ProviderOperationRequest): Promise<ProviderOperationResult> {
    this.assertCapability('AUTHORIZE', req);

    return {
      resultStatus: 'AUTHORIZED',
      providerTransactionId: `points-auth-${req.legId}`,
      raw: {
        providerType: this.providerType,
        operation: 'AUTHORIZE',
      },
    };
  }

  async capture(req: ProviderOperationRequest): Promise<ProviderOperationResult> {
    this.assertCapability('CAPTURE', req);

    return {
      resultStatus: 'CAPTURED',
      providerTransactionId: `points-capture-${req.legId}`,
      raw: {
        providerType: this.providerType,
        operation: 'CAPTURE',
      },
    };
  }

  async cancel(req: ProviderOperationRequest): Promise<ProviderOperationResult> {
    this.assertCapability('CANCEL', req);

    return {
      resultStatus: 'CANCELLED',
      providerTransactionId: `points-cancel-${req.legId}`,
      raw: {
        providerType: this.providerType,
        operation: 'CANCEL',
      },
    };
  }

  async refund(req: ProviderOperationRequest): Promise<ProviderOperationResult> {
    this.assertCapability('REFUND', req);

    return {
      resultStatus: 'REFUNDED',
      providerTransactionId: `points-refund-${req.legId}`,
      raw: {
        providerType: this.providerType,
        operation: 'REFUND',
      },
    };
  }

  async manualConfirm(
    req: ProviderOperationRequest,
  ): Promise<ProviderOperationResult> {
    this.assertCapability('MANUAL_CONFIRM', req);

    throw new Error('Unreachable');
  }

  async getTransaction(
    req: Pick<ProviderOperationRequest, 'intentId' | 'legId' | 'correlationId'>,
  ): Promise<ProviderTransactionSnapshot> {
    return {
      providerTransactionId: `points-tx-${req.legId}`,
      status: 'CAPTURED',
      raw: {
        providerType: this.providerType,
      },
    };
  }

  private assertCapability(
    operation: ProviderOperation,
    req: ProviderOperationRequest,
  ): void {
    if (!this.supports(operation, { intentId: req.intentId, legId: req.legId })) {
      throwProviderCapabilityNotSupported(this.providerType, operation);
    }
  }
}
