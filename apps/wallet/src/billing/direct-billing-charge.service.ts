import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { WalletSchema, paymentIntents, outboxEvents, IntentPurpose } from '../schema';
import { BillingMethodService } from './billing-method.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { ChargesService } from '../charges/charges.service';
import { AutoCaptureService } from '../payment-intents/auto-capture.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';
import { buildOutboxInsertValues } from '../messaging/outbox-event.util';
import { ChargeResult } from '../providers/payment-provider.interface';

export interface DirectChargeResult {
  intentId: string;
  status: 'AUTHORIZED' | 'FAILED';
}

@Injectable()
export class DirectBillingChargeService {
  private readonly logger = new Logger(DirectBillingChargeService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly billingMethodService: BillingMethodService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly chargesService: ChargesService,
    private readonly autoCaptureService: AutoCaptureService,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async charge(params: {
    userId: string;
    billingMethodId: string;
    amount: number;
    currency: string;
    purpose: string;
    metadata: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<DirectChargeResult> {
    const billingMethod = await this.billingMethodService.findById(params.billingMethodId);
    if (!billingMethod || billingMethod.status !== 'ACTIVE') {
      throw new Error('billing method not found or inactive');
    }
    if (billingMethod.userId !== params.userId) {
      throw new Error('billing method does not belong to user');
    }
    // CMS_BATCH는 효성 배치 출금 방식이라 즉시 SUCCEEDED가 불가 — 토스 결제창으로 유도해야 함
    if (billingMethod.providerType === 'CMS_BATCH') {
      throw new Error('CMS_BATCH billing method cannot be used for immediate charges; use Toss payment flow instead');
    }

    // 멱등성: 동일 idempotencyKey의 기존 intent가 있으면 현재 상태 반환
    const [existingIntent] = await this.dbService.db
      .select({ id: paymentIntents.id, status: paymentIntents.status })
      .from(paymentIntents)
      .where(sql`${paymentIntents.metadata}->>'idempotencyKey' = ${params.idempotencyKey}`)
      .limit(1);

    if (existingIntent) {
      this.logger.log(
        `[DirectBillingCharge] idempotent return: key=${params.idempotencyKey} intentId=${existingIntent.id} status=${existingIntent.status}`,
      );
      const successStatuses = new Set(['AUTHORIZED', 'CAPTURED', 'SUCCEEDED']);
      const failedStatuses = new Set(['FAILED', 'CANCELED']);
      if (successStatuses.has(existingIntent.status)) {
        return { intentId: existingIntent.id, status: 'AUTHORIZED' };
      }
      if (failedStatuses.has(existingIntent.status)) {
        return { intentId: existingIntent.id, status: 'FAILED' };
      }
      // CREATED / PROCESSING / REQUIRES_ACTION / PENDING_SETTLEMENT — 아직 처리 중
      throw new Error(
        `결제가 아직 처리 중입니다. 잠시 후 다시 시도해주세요. (intentId=${existingIntent.id}, status=${existingIntent.status})`,
      );
    }

    const provider = this.providerRegistry.getProviderOrThrow(billingMethod.providerType);
    const paymentMethod = await this.billingMethodService.findOrCreateForBilling(
      params.userId,
      billingMethod.providerType,
      billingMethod.id,
    );

    const clientSecret = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const now = new Date().toISOString();
    const correlationId = `direct-charge:${params.idempotencyKey}`;

    const intent = await this.dbService.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(paymentIntents)
        .values({
          payableAmount: params.amount,
          currency: params.currency.toUpperCase(),
          status: 'CREATED',
          purpose: params.purpose as IntentPurpose,
          userId: params.userId,
          paymentMethodId: paymentMethod.id,
          clientSecret,
          returnUrl: null,
          metadata: { idempotencyKey: params.idempotencyKey, ...params.metadata },
          expiresAt,
          version: 0,
        })
        .returning();

      if (!inserted) throw new Error('PAYMENT_INTENT_INSERT_FAILED');

      await tx.insert(outboxEvents).values(
        buildOutboxInsertValues({
          eventType: GatewayEventType.INTENT_CREATED,
          aggregateType: GATEWAY_AGGREGATE_TYPE,
          aggregateId: inserted.id,
          payload: buildPaymentIntentEventPayload({
            intentId: inserted.id,
            userId: params.userId,
            status: 'CREATED',
            payableAmount: params.amount,
            currency: params.currency.toUpperCase(),
            occurredAt: now,
          }),
        }),
      );

      return inserted;
    });

    await this.stateTransitionService.transitionIntent(intent.id, 'PROCESSING', {
      correlationId,
      triggeredByType: 'COMMAND',
    });

    const chargeIdempotencyKey = `wallet:authorize:${intent.id}:${paymentMethod.id}:${Date.now()}`;
    const charge = await this.chargesService.create({
      intentId: intent.id,
      paymentMethodId: paymentMethod.id,
      amount: params.amount,
      currency: params.currency.toUpperCase(),
      operation: 'AUTHORIZE',
      status: 'CREATED',
      providerIdempotencyKey: chargeIdempotencyKey,
      requestPayload: {
        intentId: intent.id,
        paymentMethodId: paymentMethod.id,
        billingMethodId: billingMethod.id,
      },
    });

    let result: ChargeResult;
    try {
      result = await provider.authorize({
        chargeId: charge.id,
        intentId: intent.id,
        paymentMethodId: paymentMethod.id,
        userId: params.userId,
        amount: params.amount,
        currency: params.currency.toUpperCase(),
        idempotencyKey: this.chargesService.generateIdempotencyKey(charge.id, 'AUTHORIZE'),
        correlationId,
        providerData: { billingMethodId: billingMethod.id },
        metadata: params.metadata,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[DirectBillingCharge] Provider authorize threw: intentId=${intent.id}, error=${msg}`);
      await this.chargesService.updateStatus(charge.id, 'FAILED', {
        errorCode: 'PROVIDER_EXCEPTION',
        errorMessage: msg,
      });
      await this.stateTransitionService.transitionIntent(intent.id, 'FAILED', {
        correlationId,
        reasonCode: 'PROVIDER_EXCEPTION',
        reasonMessage: msg,
      });
      return { intentId: intent.id, status: 'FAILED' };
    }

    if (result.status !== 'SUCCEEDED') {
      await this.dbService.db.transaction(async (tx) => {
        await this.chargesService.updateStatus(
          charge.id,
          'FAILED',
          {
            errorCode: result.errorCode ?? 'PROVIDER_FAILED',
            errorMessage: result.errorMessage,
            responsePayload: result.raw,
          },
          tx,
        );
        await this.stateTransitionService.transitionIntent(
          intent.id,
          'FAILED',
          {
            correlationId,
            reasonCode: result.errorCode ?? 'PROVIDER_FAILED',
            reasonMessage: result.errorMessage,
            outboxEvent: {
              eventType: GatewayEventType.INTENT_FAILED,
              aggregateType: GATEWAY_AGGREGATE_TYPE,
              aggregateId: intent.id,
              payload: buildPaymentIntentEventPayload({
                intentId: intent.id,
                userId: params.userId,
                status: 'FAILED',
                payableAmount: params.amount,
                currency: params.currency.toUpperCase(),
                occurredAt: new Date().toISOString(),
                extra: { errorCode: result.errorCode, errorMessage: result.errorMessage },
              }),
            },
          },
          undefined,
          tx,
        );
      });
      return { intentId: intent.id, status: 'FAILED' };
    }

    await this.dbService.db.transaction(async (tx) => {
      await this.chargesService.updateStatus(
        charge.id,
        'SUCCEEDED',
        { providerTransactionId: result.providerTransactionId, responsePayload: result.raw },
        tx,
      );
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
              userId: params.userId,
              status: 'AUTHORIZED',
              payableAmount: params.amount,
              currency: params.currency.toUpperCase(),
              occurredAt: new Date().toISOString(),
            }),
          },
        },
        undefined,
        tx,
      );
    });

    await this.autoCaptureService.attemptAutoCapture(intent.id, correlationId);

    return { intentId: intent.id, status: 'AUTHORIZED' };
  }
}
