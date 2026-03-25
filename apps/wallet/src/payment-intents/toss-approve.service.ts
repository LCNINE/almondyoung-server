import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, paymentIntents } from '../schema';
import { Charge, PaymentIntent } from '../types';
import { ChargesService } from '../charges/charges.service';
import { AutoCaptureService } from './auto-capture.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';

@Injectable()
export class TossApproveService {
  private readonly logger = new Logger(TossApproveService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly chargesService: ChargesService,
    private readonly autoCaptureService: AutoCaptureService,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async approve(
    intentId: string,
    paymentKey: string,
    orderId: string,
    amount: number,
    correlationId: string,
  ): Promise<void> {
    this.logger.log(`approve called: intentId=${intentId} orderId=${orderId} amount=${amount}`);

    // 1. Find the REQUIRES_ACTION AUTHORIZE charge
    const charge = await this.chargesService.findActiveByIntentAndOperation(intentId, 'AUTHORIZE');
    this.logger.log(`charge found: ${JSON.stringify({ id: charge?.id, status: charge?.status })}`);
    if (!charge || charge.status !== 'REQUIRES_ACTION') {
      throw new UnprocessableEntityException({
        error: 'NO_REQUIRES_ACTION_CHARGE',
        message: 'No pending Toss action found for this intent',
      });
    }

    // 2. Call Toss API confirm
    const secretKey = process.env.TOSS_SECRET_KEY ?? '';
    const auth = Buffer.from(`${secretKey}:`).toString('base64');
    const tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });

    this.logger.log(`Toss API confirm response: status=${tossRes.status}`);
    if (!tossRes.ok) {
      const err = await tossRes.json().catch(() => ({}));
      this.logger.error(`Toss API confirm failed: ${JSON.stringify(err)}`);
      await this.finalizeFailure(charge, err.code ?? 'TOSS_CONFIRM_FAILED', correlationId);
      throw new UnprocessableEntityException({
        error: err.code ?? 'TOSS_CONFIRM_FAILED',
        message: err.message,
      });
    }

    const tossData = await tossRes.json();
    await this.finalizeApproval(charge, tossData.paymentKey, correlationId);
  }

  async finalizeApproval(charge: Charge, paymentKey: string, correlationId: string): Promise<void> {
    const intent = await this.loadIntent(charge.intentId);
    const now = new Date().toISOString();

    await this.dbService.db.transaction(async (tx) => {
      await this.chargesService.updateStatus(charge.id, 'SUCCEEDED', { providerTransactionId: paymentKey }, tx);

      await this.stateTransitionService.transitionIntent(
        intent.id,
        'AUTHORIZED',
        {
          correlationId,
          reasonCode: 'AUTHORIZE_SUCCEEDED',
          outboxEvent: {
            eventType: GatewayEventType.INTENT_AUTHORIZED,
            aggregateType: GATEWAY_AGGREGATE_TYPE,
            aggregateId: intent.id,
            payload: buildPaymentIntentEventPayload({
              intentId: intent.id,
              userId: intent.userId ?? '',
              status: 'AUTHORIZED',
              payableAmount: intent.payableAmount,
              currency: intent.currency,
              occurredAt: now,
              extra: { medusa_session_id: intent.metadata?.medusa_session_id },
            }),
          },
        },
        undefined,
        tx,
      );
    });

    await this.autoCaptureService.attemptAutoCapture(charge.intentId, correlationId);
  }

  async finalizeFailure(charge: Charge, errorCode: string, correlationId: string): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      await this.chargesService.updateStatus(
        charge.id,
        'FAILED',
        {
          errorCode,
          errorMessage: `Payment ${errorCode.toLowerCase()} on Toss side`,
        },
        tx,
      );

      await this.stateTransitionService.transitionIntent(
        charge.intentId,
        'CREATED',
        {
          correlationId,
          reasonCode: 'AUTHORIZE_FAILED',
          reasonMessage: errorCode,
        },
        undefined,
        tx,
      );
    });
  }

  private async loadIntent(intentId: string): Promise<PaymentIntent> {
    const intent = await this.dbService.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1)
      .then((r) => r[0]);

    if (!intent) {
      throw new NotFoundException({ error: 'INTENT_NOT_FOUND' });
    }

    return intent;
  }
}
