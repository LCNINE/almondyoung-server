import { Injectable } from '@nestjs/common';
import { PaymentIntent } from '../types';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { ChargeReleaseService } from './charge-release.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';

@Injectable()
export class CancelService {
  constructor(
    private readonly chargeReleaseService: ChargeReleaseService,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async cancel(intent: PaymentIntent, correlationId: string): Promise<void> {
    // 1. Release all provider-side holds/authorizations backing this intent's charges
    //    (active AUTHORIZE charge → CANCELED, SUCCEEDED AUTHORIZE charges → provider cancel).
    await this.chargeReleaseService.releaseIntentCharges(intent, correlationId);

    // 2. Transition intent → CANCELED + outbox event
    const now = new Date().toISOString();
    await this.stateTransitionService.transitionIntent(intent.id, 'CANCELED', {
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
    });
  }
}
