import { Controller, Logger, UseFilters, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope, EventsExceptionFilter } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { BillingChargePayload } from '@packages/event-contracts/streams/wallet-command.stream';
import { DomainEvent } from '@packages/event-contracts/types';
import { DbService } from '@app/db';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  WalletSchema,
  paymentIntents,
  outboxEvents,
  IntentPurpose,
} from '../schema';
import { BillingAgreementService } from '../billing/billing-agreement.service';
import { BillingMethodService } from '../billing/billing-method.service';
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

const DEFAULT_INTENT_EXPIRY_MINUTES = 60 * 24; // 24 hours

@Controller()
@UseFilters(EventsExceptionFilter)
@UseInterceptors(EventTypeGuard)
export class BillingChargeConsumer {
  private readonly logger = new Logger(BillingChargeConsumer.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly billingAgreementService: BillingAgreementService,
    private readonly billingMethodService: BillingMethodService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly chargesService: ChargesService,
    private readonly autoCaptureService: AutoCaptureService,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  @OnEvent('wallet.commands.v1', 'BillingCharge')
  async onBillingCharge(
    @EventEnvelope() envelope: DomainEvent<BillingChargePayload>,
    @EventPayload() payload: BillingChargePayload,
  ) {
    const correlationId = envelope.correlationId ?? `billing-charge:${payload.idempotencyKey}`;

    this.logger.log(
      `[BillingCharge] Received: subscriberRef=${payload.subscriberRef}, subscriberType=${payload.subscriberType}, amount=${payload.amount} (correlationId: ${correlationId})`,
    );

    // 1. billing_agreement 조회
    const agreement = await this.billingAgreementService.findBySubscriberRef(
      payload.subscriberType,
      payload.subscriberRef,
    );

    if (!agreement) {
      this.logger.error(
        `[BillingCharge] No active billing agreement: subscriberRef=${payload.subscriberRef}, subscriberType=${payload.subscriberType}`,
      );
      await this.emitFailedEvent(
        correlationId,
        payload,
        'BILLING_AGREEMENT_NOT_FOUND',
        'No active billing agreement found',
      );
      return;
    }

    // 2. billingMethod 조회
    const billingMethod = await this.billingMethodService.findById(agreement.billingMethodId);
    if (!billingMethod || billingMethod.status !== 'ACTIVE') {
      this.logger.error(
        `[BillingCharge] Billing method inactive: billingMethodId=${agreement.billingMethodId}`,
      );
      await this.emitFailedEvent(
        correlationId,
        payload,
        'BILLING_METHOD_NOT_ACTIVE',
        'Billing method is not active',
      );
      return;
    }

    // 3. Provider 결정
    const providerType = billingMethod.providerType; // 'TOSS_BILLING' | 'CMS_BATCH'
    let provider;
    try {
      provider = this.providerRegistry.getProviderOrThrow(providerType);
    } catch {
      this.logger.error(`[BillingCharge] Provider not found: ${providerType}`);
      await this.emitFailedEvent(
        correlationId,
        payload,
        'PROVIDER_NOT_FOUND',
        `Payment provider not supported: ${providerType}`,
      );
      return;
    }

    // 4. paymentMethod 레코드 생성 (빌링 결제용)
    const paymentMethod = await this.billingMethodService.findOrCreateForBilling(
      agreement.userId,
      providerType,
      billingMethod.id,
    );

    // 5. PaymentIntent 생성 — idempotency: 같은 key로 이미 처리된 intent가 있으면 skip
    const [existingIntent] = await this.dbService.db
      .select({ id: paymentIntents.id, status: paymentIntents.status })
      .from(paymentIntents)
      .where(sql`${paymentIntents.metadata}->>'idempotencyKey' = ${payload.idempotencyKey}`)
      .limit(1);

    if (existingIntent) {
      this.logger.log(
        `[BillingCharge] Duplicate command skipped (idempotencyKey=${payload.idempotencyKey}): intentId=${existingIntent.id}, status=${existingIntent.status}`,
      );
      return;
    }

    const clientSecret = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + DEFAULT_INTENT_EXPIRY_MINUTES * 60 * 1000);
    const now = new Date().toISOString();
    const purpose = payload.purpose as IntentPurpose;

    let intentId: string;
    try {
      const intent = await this.dbService.db.transaction(async (tx) => {
        const insertedIntents = await tx
          .insert(paymentIntents)
          .values({
            payableAmount: payload.amount,
            currency: payload.currency.toUpperCase(),
            status: 'CREATED',
            purpose,
            userId: agreement.userId,
            paymentMethodId: paymentMethod.id,
            clientSecret,
            returnUrl: null,
            metadata: {
              billingAgreementId: agreement.id,
              subscriberRef: payload.subscriberRef,
              subscriberType: payload.subscriberType,
              idempotencyKey: payload.idempotencyKey,
              ...(payload.metadata ?? {}),
            },
            expiresAt,
            version: 0,
          })
          .returning();

        const created = insertedIntents[0];
        if (!created) throw new Error('PAYMENT_INTENT_INSERT_FAILED');

        // Outbox: intent.created
        await tx.insert(outboxEvents).values(
          buildOutboxInsertValues({
            eventType: GatewayEventType.INTENT_CREATED,
            aggregateType: GATEWAY_AGGREGATE_TYPE,
            aggregateId: created.id,
            payload: buildPaymentIntentEventPayload({
              intentId: created.id,
              userId: agreement.userId,
              status: 'CREATED',
              payableAmount: payload.amount,
              currency: payload.currency.toUpperCase(),
              occurredAt: now,
              extra: {
                purpose,
                subscriberRef: payload.subscriberRef,
                subscriberType: payload.subscriberType,
              },
            }),
          }),
        );

        return created;
      });
      intentId = intent.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[BillingCharge] Intent creation failed: ${msg}`);
      throw err; // 재시도 (DLQ)
    }

    // 6. 슬롯 파이프라인 실행 (primary only, no discount)
    try {
      // Transition to PROCESSING
      await this.stateTransitionService.transitionIntent(intentId, 'PROCESSING', {
        correlationId,
        triggeredByType: 'COMMAND',
      });

      // Create AUTHORIZE charge record
      const idempotencyKey = `wallet:authorize:${intentId}:${paymentMethod.id}`;
      const charge = await this.chargesService.create({
        intentId,
        paymentMethodId: paymentMethod.id,
        amount: payload.amount,
        currency: payload.currency.toUpperCase(),
        operation: 'AUTHORIZE',
        status: 'CREATED',
        providerIdempotencyKey: idempotencyKey,
        requestPayload: {
          intentId,
          paymentMethodId: paymentMethod.id,
          billingMethodId: billingMethod.id,
        },
      });

      // Authorize via provider
      const chargeIdempotencyKey = this.chargesService.generateIdempotencyKey(charge.id, 'AUTHORIZE');
      let result: ChargeResult;
      try {
        result = await provider.authorize({
          chargeId: charge.id,
          intentId,
          paymentMethodId: paymentMethod.id,
          userId: agreement.userId,
          amount: payload.amount,
          currency: payload.currency.toUpperCase(),
          idempotencyKey: chargeIdempotencyKey,
          correlationId,
          providerData: { billingMethodId: billingMethod.id },
          metadata: payload.metadata,
        });
      } catch (err) {
        // 5xx / 네트워크 에러: throw → DLQ 재시도
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[BillingCharge] Provider authorize threw: intentId=${intentId}, error=${msg}`);
        await this.chargesService.updateStatus(charge.id, 'FAILED', {
          errorCode: 'PROVIDER_EXCEPTION',
          errorMessage: msg,
        });
        await this.stateTransitionService.transitionIntent(intentId, 'FAILED', {
          correlationId,
          reasonCode: 'PROVIDER_EXCEPTION',
          reasonMessage: msg,
        });
        throw err;
      }

      // 7. 결과 처리
      await this.handleAuthorizeResult(intentId, charge.id, result, agreement.userId, payload, correlationId);
    } catch (err) {
      // 이미 처리된 비즈니스 에러가 아닌 경우에만 재throw
      if ((err as { _billingChargeHandled?: boolean })?._billingChargeHandled) return;
      throw err;
    }
  }

  // ─── Result handling ────────────────────────────────────────────────────────

  private async handleAuthorizeResult(
    intentId: string,
    chargeId: string,
    result: ChargeResult,
    userId: string,
    payload: BillingChargePayload,
    correlationId: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    switch (result.status) {
      case 'SUCCEEDED': {
        // charge → SUCCEEDED, intent → AUTHORIZED → auto-capture
        await this.dbService.db.transaction(async (tx) => {
          await this.chargesService.updateStatus(chargeId, 'SUCCEEDED', {
            providerTransactionId: result.providerTransactionId,
            responsePayload: result.raw,
          }, tx);

          await this.stateTransitionService.transitionIntent(
            intentId,
            'AUTHORIZED',
            {
              correlationId,
              reasonCode: 'AUTHORIZE_SUCCEEDED',
              outboxEvent: {
                eventType: GatewayEventType.INTENT_AUTHORIZED,
                aggregateType: GATEWAY_AGGREGATE_TYPE,
                aggregateId: intentId,
                payload: buildPaymentIntentEventPayload({
                  intentId,
                  userId,
                  status: 'AUTHORIZED',
                  payableAmount: payload.amount,
                  currency: payload.currency.toUpperCase(),
                  occurredAt: now,
                  extra: {
                    purpose: payload.purpose,
                    subscriberRef: payload.subscriberRef,
                    subscriberType: payload.subscriberType,
                  },
                }),
              },
            },
            undefined,
            tx,
          );
        });

        // Auto-capture
        await this.autoCaptureService.attemptAutoCapture(intentId, correlationId);

        this.logger.log(
          `[BillingCharge] Succeeded: intentId=${intentId}, subscriberRef=${payload.subscriberRef}`,
        );
        return;
      }

      case 'PENDING': {
        // CMS 배치: charge → PENDING, intent → PENDING_SETTLEMENT
        await this.chargesService.updateStatus(chargeId, 'PENDING', {
          providerTransactionId: result.providerTransactionId,
          responsePayload: result.raw,
        });

        await this.stateTransitionService.transitionIntent(intentId, 'PENDING_SETTLEMENT', {
          correlationId,
          reasonCode: 'PENDING_SETTLEMENT',
          reasonMessage: 'Awaiting external settlement result (CMS batch)',
        });

        this.logger.log(
          `[BillingCharge] Pending settlement: intentId=${intentId}, subscriberRef=${payload.subscriberRef}`,
        );
        return;
      }

      default: {
        // FAILED — 4xx/비즈니스 오류: 즉시 실패 이벤트, 재시도 없음
        await this.dbService.db.transaction(async (tx) => {
          await this.chargesService.updateStatus(chargeId, 'FAILED', {
            errorCode: result.errorCode ?? 'PROVIDER_FAILED',
            errorMessage: result.errorMessage ?? 'Provider authorization failed',
            responsePayload: result.raw,
          }, tx);

          await this.stateTransitionService.transitionIntent(
            intentId,
            'FAILED',
            {
              correlationId,
              reasonCode: result.errorCode ?? 'BILLING_CHARGE_FAILED',
              reasonMessage: result.errorMessage ?? 'Billing charge authorization failed',
              outboxEvent: {
                eventType: GatewayEventType.INTENT_FAILED,
                aggregateType: GATEWAY_AGGREGATE_TYPE,
                aggregateId: intentId,
                payload: buildPaymentIntentEventPayload({
                  intentId,
                  userId,
                  status: 'FAILED',
                  payableAmount: payload.amount,
                  currency: payload.currency.toUpperCase(),
                  occurredAt: now,
                  extra: {
                    purpose: payload.purpose,
                    subscriberRef: payload.subscriberRef,
                    subscriberType: payload.subscriberType,
                    errorCode: result.errorCode,
                    errorMessage: result.errorMessage,
                  },
                }),
              },
            },
            undefined,
            tx,
          );
        });

        this.logger.warn(
          `[BillingCharge] Failed: intentId=${intentId}, error=${result.errorCode}: ${result.errorMessage}`,
        );

        // Mark as handled so outer catch doesn't rethrow
        const handled = new Error('billing charge failed (business error)');
        (handled as { _billingChargeHandled?: boolean })._billingChargeHandled = true;
        throw handled;
      }
    }
  }

  /**
   * billing agreement가 없거나 billing method가 비활성인 경우
   * 즉시 실패 이벤트를 발행 (Intent 생성 전이므로 직접 outbox에 기록)
   */
  private async emitFailedEvent(
    correlationId: string,
    payload: BillingChargePayload,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    try {
      await this.dbService.db.insert(outboxEvents).values(
        buildOutboxInsertValues({
          eventType: GatewayEventType.INTENT_FAILED,
          aggregateType: GATEWAY_AGGREGATE_TYPE,
          aggregateId: `billing-charge:${payload.idempotencyKey}`,
          partitionKey: `${payload.subscriberType}:${payload.subscriberRef}`,
          payload: {
            subscriberRef: payload.subscriberRef,
            subscriberType: payload.subscriberType,
            amount: payload.amount,
            currency: payload.currency,
            purpose: payload.purpose,
            errorCode,
            errorMessage,
            occurredAt: now,
          },
        }),
      );
    } catch (err) {
      this.logger.error(`[BillingCharge] Failed to emit failure event: ${err}`);
    }
  }
}
