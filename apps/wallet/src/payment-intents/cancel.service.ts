import { Injectable, Logger } from '@nestjs/common';
import { PaymentIntent } from '../types';
import { ChargesService } from '../charges/charges.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';

@Injectable()
export class CancelService {
  private readonly logger = new Logger(CancelService.name);

  constructor(
    private readonly chargesService: ChargesService,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async cancel(intent: PaymentIntent, correlationId: string): Promise<void> {
    // 1. Cancel any active AUTHORIZE charge (DB only — no provider call needed for in-flight charges)
    const activeCharge = await this.chargesService.findActiveByIntentAndOperation(
      intent.id,
      'AUTHORIZE',
    );
    if (activeCharge) {
      await this.chargesService.updateStatus(activeCharge.id, 'CANCELED', {});
    }

    // 2. Cancel all SUCCEEDED AUTHORIZE charges via their respective providers
    //    (POINTS requires a hold-release call; TOSS/others require a refund/cancel API call)
    const succeededAuthorizeCharges =
      await this.chargesService.findAllSucceededAuthorizeByIntent(intent.id);
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
          `Failed to cancel ${method.type} charge during cancel: intentId=${intent.id}, chargeId=${charge.id}, error=${err}`,
        );
        // Continue to cancel the intent even if individual provider cancel fails
      }
    }

    // 3. Transition intent → CANCELED + outbox event
    const now = new Date().toISOString();
    await this.stateTransitionService.transitionIntent(
      intent.id,
      'CANCELED',
      {
        correlationId,
        triggeredByType: 'USER',
        reasonCode: 'USER_CANCELED',
        outboxEvent: {
          eventType: GatewayEventType.INTENT_CANCELED,
          aggregateType: GATEWAY_AGGREGATE_TYPE,
          aggregateId: intent.id,
          payload: buildPaymentIntentEventPayload({
            intentId: intent.id,
            userId: intent.userId ?? '',
            status: 'CANCELED',
            payableAmount: intent.payableAmount,
            currency: intent.currency,
            occurredAt: now,
          }),
        },
      },
    );
  }
}
