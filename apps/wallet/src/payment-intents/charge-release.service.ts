import { Injectable, Logger } from '@nestjs/common';
import { ChargesService } from '../charges/charges.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { ProviderRegistry } from '../providers/provider.registry';

/** Minimal intent shape required to release its charges. */
export interface ReleasableIntent {
  id: string;
  userId: string | null;
  currency: string;
}

/**
 * Releases the provider-side holds/authorizations backing an intent's charges,
 * without owning the intent's terminal state transition.
 *
 * Extracted from CancelService so that cancel, expiration, and confirm-retry
 * share one cleanup path (POINTS hold release, TOSS cancel, …).
 */
@Injectable()
export class ChargeReleaseService {
  private readonly logger = new Logger(ChargeReleaseService.name);

  constructor(
    private readonly chargesService: ChargesService,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async releaseIntentCharges(intent: ReleasableIntent, correlationId: string): Promise<void> {
    // Cancel any active AUTHORIZE charge (DB only — no provider call needed for in-flight charges).
    const activeCharge = await this.chargesService.findActiveByIntentAndOperation(intent.id, 'AUTHORIZE');
    if (activeCharge) {
      await this.chargesService.updateStatus(activeCharge.id, 'CANCELED', {});
    }

    // Release all SUCCEEDED AUTHORIZE charges via their respective providers
    // (POINTS requires a hold-release call; TOSS/others require a refund/cancel API call).
    const succeededAuthorizeCharges = await this.chargesService.findAllSucceededAuthorizeByIntent(intent.id);
    for (const charge of succeededAuthorizeCharges) {
      const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
      if (!method) continue;
      const provider = this.providerRegistry.getProviderOrThrow(method.type);
      try {
        await provider.cancel({
          chargeId: charge.id,
          intentId: intent.id,
          paymentMethodId: charge.paymentMethodId,
          userId: intent.userId ?? '',
          amount: charge.amount,
          currency: intent.currency,
          idempotencyKey: `wallet:cancel:${method.type.toLowerCase()}:${charge.id}:${correlationId}`,
          correlationId,
        });
        await this.chargesService.updateStatus(charge.id, 'CANCELED', {});
      } catch (err) {
        this.logger.error(
          `Failed to release ${method.type} charge: intentId=${intent.id}, chargeId=${charge.id}, error=${err}`,
        );
        // Continue releasing the remaining charges even if one provider call fails.
      }
    }
  }
}
