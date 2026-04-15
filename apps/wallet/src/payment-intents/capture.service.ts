import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, paymentIntents } from '../schema';
import { Charge } from '../types';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { ChargesService } from '../charges/charges.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';

@Injectable()
export class CaptureService {
  private readonly logger = new Logger(CaptureService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly chargesService: ChargesService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async capture(intentId: string, correlationId: string): Promise<void> {
    // Find all SUCCEEDED AUTHORIZE charges (ordered by createdAt asc; POINTS always first)
    const authorizeCharges = await this.chargesService.findAllSucceededAuthorizeByIntent(intentId);

    if (authorizeCharges.length === 0) {
      throw new UnprocessableEntityException({
        error: 'NO_AUTHORIZE_CHARGE',
        message: `No succeeded AUTHORIZE charge found for intent: ${intentId}`,
      });
    }

    const intentInfo = await this.getIntentInfo(intentId);
    if (!intentInfo) {
      throw new UnprocessableEntityException({
        error: 'INTENT_NOT_FOUND',
        message: `Intent not found: ${intentId}`,
      });
    }
    const userId = intentInfo.userId ?? '';

    const results: { charge: Charge; succeeded: boolean }[] = [];

    for (const authorizeCharge of authorizeCharges) {
      const succeeded = await this.captureOneLeg(authorizeCharge, userId, intentId, correlationId);
      results.push({ charge: authorizeCharge, succeeded });
    }

    const succeededCount = results.filter((r) => r.succeeded).length;
    const totalCount = results.length;

    const now = new Date().toISOString();
    const totalCaptured = authorizeCharges.reduce((s, c) => s + c.amount, 0);

    if (succeededCount === totalCount) {
      // All succeeded → CAPTURED
      await this.stateTransitionService.transitionIntent(intentId, 'CAPTURED', {
        correlationId,
        reasonCode: 'CAPTURE_SUCCEEDED',
        outboxEvent: {
          eventType: GatewayEventType.INTENT_CAPTURED,
          aggregateType: GATEWAY_AGGREGATE_TYPE,
          aggregateId: intentId,
          payload: buildPaymentIntentEventPayload({
            intentId,
            userId,
            status: 'CAPTURED',
            payableAmount: totalCaptured,
            currency: authorizeCharges[0].currency,
            occurredAt: now,
          }),
        },
      });
    } else if (succeededCount > 0) {
      // Partial success → PARTIALLY_CAPTURED + 운영 알림
      await this.stateTransitionService.transitionIntent(intentId, 'PARTIALLY_CAPTURED', {
        correlationId,
        reasonCode: 'CAPTURE_PARTIAL',
        reasonMessage: `${succeededCount}/${totalCount} charges captured successfully. Manual resolution required.`,
        outboxEvent: {
          eventType: 'payment.intent.partially_captured',
          aggregateType: GATEWAY_AGGREGATE_TYPE,
          aggregateId: intentId,
          payload: buildPaymentIntentEventPayload({
            intentId,
            userId,
            status: 'PARTIALLY_CAPTURED',
            payableAmount: totalCaptured,
            currency: authorizeCharges[0].currency,
            occurredAt: now,
            extra: {
              succeededCount,
              totalCount,
              failedChargeIds: results.filter((r) => !r.succeeded).map((r) => r.charge.id),
            },
          }),
        },
      });

      this.logger.error(
        `PARTIALLY_CAPTURED: intentId=${intentId}, succeeded=${succeededCount}/${totalCount}. Manual resolution required.`,
      );
    } else {
      // All failed → FAILED
      await this.stateTransitionService.transitionIntent(intentId, 'FAILED', {
        correlationId,
        reasonCode: 'CAPTURE_FAILED',
        reasonMessage: 'All capture attempts failed',
        outboxEvent: {
          eventType: GatewayEventType.INTENT_FAILED,
          aggregateType: GATEWAY_AGGREGATE_TYPE,
          aggregateId: intentId,
          payload: buildPaymentIntentEventPayload({
            intentId,
            userId,
            status: 'FAILED',
            payableAmount: totalCaptured,
            currency: authorizeCharges[0].currency,
            occurredAt: now,
          }),
        },
      });
    }
  }

  private async captureOneLeg(
    authorizeCharge: Charge,
    userId: string,
    intentId: string,
    correlationId: string,
  ): Promise<boolean> {
    const method = await this.paymentMethodsService.findById(authorizeCharge.paymentMethodId);
    if (!method) {
      this.logger.error(`Payment method not found for charge: ${authorizeCharge.id}`);
      return false;
    }

    const captureCharge = await this.chargesService.create({
      intentId,
      paymentMethodId: method.id,
      amount: authorizeCharge.amount,
      currency: authorizeCharge.currency,
      operation: 'CAPTURE',
      status: 'CREATED',
      providerIdempotencyKey: this.chargesService.generateIdempotencyKey(authorizeCharge.id, 'CAPTURE'),
      requestPayload: { intentId, authorizeChargeId: authorizeCharge.id },
    });

    const provider = this.providerRegistry.getProviderOrThrow(method.type);

    let providerResult: Awaited<ReturnType<typeof provider.capture>>;
    try {
      providerResult = await provider.capture({
        chargeId: authorizeCharge.id,
        intentId,
        paymentMethodId: method.id,
        userId,
        amount: captureCharge.amount,
        currency: captureCharge.currency,
        idempotencyKey: captureCharge.providerIdempotencyKey,
        correlationId,
        providerData: method.providerData,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Provider capture threw: intentId=${intentId}, authorizeChargeId=${authorizeCharge.id}, error=${msg}`,
      );
      await this.chargesService.updateStatus(captureCharge.id, 'FAILED', {
        errorCode: 'PROVIDER_EXCEPTION',
        errorMessage: msg,
      });
      return false;
    }

    if (providerResult.status === 'SUCCEEDED') {
      await this.chargesService.updateStatus(captureCharge.id, 'SUCCEEDED', {
        providerTransactionId:
          providerResult.providerTransactionId ?? authorizeCharge.providerTransactionId ?? undefined,
        responsePayload: providerResult.raw,
      });
      return true;
    } else {
      await this.chargesService.updateStatus(captureCharge.id, 'FAILED', {
        errorCode: providerResult.errorCode ?? 'CAPTURE_FAILED',
        errorMessage: providerResult.errorMessage ?? 'Capture failed',
        responsePayload: providerResult.raw,
      });
      return false;
    }
  }

  private async getIntentInfo(intentId: string): Promise<{ userId: string | null } | null> {
    const rows = await this.dbService.db
      .select({ userId: paymentIntents.userId })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { userId: row.userId };
  }
}
