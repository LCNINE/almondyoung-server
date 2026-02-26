import { Injectable, Logger } from '@nestjs/common';
import { PaymentIntent } from '../types';
import { ChargesService } from '../charges/charges.service';
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
    private readonly providerRegistry: ProviderRegistry,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async cancel(intent: PaymentIntent, correlationId: string): Promise<void> {
    // 1. Cancel any active AUTHORIZE charge (DB only — no provider call needed for TOSS/BANK_TRANSFER)
    const activeCharge = await this.chargesService.findActiveByIntentAndOperation(
      intent.id,
      'AUTHORIZE',
    );
    if (activeCharge) {
      await this.chargesService.updateStatus(activeCharge.id, 'CANCELED', {});
    }

    // 2. Cancel any SUCCEEDED POINTS AUTHORIZE hold (requires provider call to release the hold)
    const pointsCharge = await this.chargesService.findSucceededPointsAuthorizeByIntent(
      intent.id,
    );
    if (pointsCharge) {
      const pointsProvider = this.providerRegistry.getProviderOrThrow('POINTS');
      try {
        await pointsProvider.cancel({
          chargeId: pointsCharge.id,
          intentId: intent.id,
          paymentMethodId: pointsCharge.paymentMethodId,
          userId: intent.userId,
          amount: pointsCharge.amount,
          currency: intent.currency,
          idempotencyKey: `wallet:cancel:points:${pointsCharge.id}:${correlationId}`,
          correlationId,
        });
        await this.chargesService.updateStatus(pointsCharge.id, 'CANCELED', {});
      } catch (err) {
        this.logger.error(
          `Failed to cancel POINTS hold during cancel: intentId=${intent.id}, chargeId=${pointsCharge.id}, error=${err}`,
        );
        // Continue to cancel the intent even if POINTS release fails
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
            userId: intent.userId,
            status: 'CANCELED',
            payableAmount: intent.payableAmount,
            currency: intent.currency,
            occurredAt: now,
            extra: { medusa_session_id: (intent.metadata as Record<string, unknown>)?.medusa_session_id },
          }),
        },
      },
    );
  }
}
