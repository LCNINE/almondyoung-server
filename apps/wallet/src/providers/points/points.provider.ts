import { BadRequestException, Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import {
  CapabilityContext,
  PollablePaymentProvider,
  ProviderExecuteCommand,
  ProviderCapability,
  ProviderOperation,
  ProviderOperationRequest,
  ProviderOperationResult,
  ProviderTransactionRequest,
  ProviderTransactionSnapshot,
  ValidateLegRequest,
} from '../payment-provider.types';
import { throwProviderCapabilityNotSupported } from '../provider.errors';
import { WalletSchema } from '../../schema';
import { PointsLedgerService } from './points-ledger.service';

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
export class PointsPaymentProvider implements PollablePaymentProvider {
  readonly providerType = 'POINTS';
  readonly version = 'v1';

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly pointsLedgerService: PointsLedgerService,
  ) {}

  getStaticCapabilities(): ProviderCapability[] {
    return POINTS_CAPABILITIES;
  }

  resolveRuntimeCapabilities(_ctx: CapabilityContext): ProviderCapability[] {
    return POINTS_CAPABILITIES;
  }

  supports(capability: ProviderCapability, ctx?: CapabilityContext): boolean {
    const capabilities = this.resolveRuntimeCapabilities(
      ctx ?? {
        intentId: '',
      },
    );
    return capabilities.includes(capability);
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

  async execute(cmd: ProviderExecuteCommand): Promise<ProviderOperationResult> {
    switch (cmd.op) {
      case 'AUTHORIZE':
        return this.executeAuthorize(cmd.params);
      case 'CAPTURE':
        return this.executeCapture(cmd.params);
      case 'CANCEL':
        return this.executeCancel(cmd.params);
      case 'REFUND':
        return this.executeRefund(cmd.params);
      case 'MANUAL_CONFIRM':
        return this.executeManualConfirm(cmd.params);
    }
  }

  private async executeAuthorize(
    req: ProviderOperationRequest,
  ): Promise<ProviderOperationResult> {
    this.assertCapability('AUTHORIZE', req);
    return this.dbService.db.transaction((tx) =>
      this.pointsLedgerService.authorize(tx, req),
    );
  }

  private async executeCapture(
    req: ProviderOperationRequest,
  ): Promise<ProviderOperationResult> {
    this.assertCapability('CAPTURE', req);
    return this.dbService.db.transaction((tx) =>
      this.pointsLedgerService.capture(tx, req),
    );
  }

  private async executeCancel(req: ProviderOperationRequest): Promise<ProviderOperationResult> {
    this.assertCapability('CANCEL', req);
    return this.dbService.db.transaction((tx) =>
      this.pointsLedgerService.cancel(tx, req),
    );
  }

  private async executeRefund(req: ProviderOperationRequest): Promise<ProviderOperationResult> {
    this.assertCapability('REFUND', req);
    return this.dbService.db.transaction((tx) =>
      this.pointsLedgerService.refund(tx, req),
    );
  }

  private async executeManualConfirm(
    req: ProviderOperationRequest,
  ): Promise<ProviderOperationResult> {
    this.assertCapability('MANUAL_CONFIRM', req);

    throw new Error('Unreachable');
  }

  async getTransaction(
    req: ProviderTransactionRequest,
  ): Promise<ProviderTransactionSnapshot> {
    return this.dbService.db.transaction((tx) =>
      this.pointsLedgerService.getTransaction(tx, req),
    );
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
