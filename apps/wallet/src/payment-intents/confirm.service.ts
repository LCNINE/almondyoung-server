import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, sql } from 'drizzle-orm';
import { WalletSchema, paymentIntents } from '../schema';
import { DbTx } from '../types';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { PaymentCustomersService } from '../payment-customers/payment-customers.service';
import { ChargesService } from '../charges/charges.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';
import { buildOutboxInsertValues } from '../messaging/outbox-event.util';

@Injectable()
export class ConfirmService {
  private readonly logger = new Logger(ConfirmService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly customersService: PaymentCustomersService,
    private readonly chargesService: ChargesService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async confirm(
    intentId: string,
    paymentMethodId: string,
    correlationId: string,
  ): Promise<void> {
    return this.dbService.db.transaction(async (tx) => {
      // 1. Load intent with FOR UPDATE lock
      const intent = await this.lockIntent(intentId, tx);
      if (!intent) {
        throw new NotFoundException({
          error: 'INTENT_NOT_FOUND',
          message: `Payment intent not found: ${intentId}`,
        });
      }

      // 2. Validate intent status
      const allowedStatuses = ['CREATED', 'PROCESSING', 'REQUIRES_ACTION'] as const;
      if (!allowedStatuses.includes(intent.status as any)) {
        throw new ConflictException({
          error: 'INTENT_STATUS_INVALID',
          message: `Intent cannot be confirmed in status: ${intent.status}`,
        });
      }

      // 3. Cancel any in-progress charge (previous failed attempt)
      const existingActive = await this.chargesService.findActiveByIntentAndOperation(
        intentId,
        'AUTHORIZE',
        tx,
      );
      if (existingActive) {
        await this.cancelStaleCharge(existingActive.id, correlationId, tx);
      }

      // 4. Load payment method
      const method = await this.paymentMethodsService.findById(paymentMethodId, tx);
      if (!method) {
        throw new NotFoundException({
          error: 'PAYMENT_METHOD_NOT_FOUND',
          message: `Payment method not found: ${paymentMethodId}`,
        });
      }

      // 5. Load customer
      const customer = await this.customersService.findById(intent.customerId, tx);
      if (!customer) {
        throw new UnprocessableEntityException({
          error: 'CUSTOMER_NOT_FOUND',
          message: `Customer not found for intent: ${intentId}`,
        });
      }

      // 6. Create charge record
      const idempotencyKey = `wallet:authorize:${intentId}:${paymentMethodId}:${Date.now()}`;
      const charge = await this.chargesService.create(
        {
          intentId,
          paymentMethodId,
          amount: intent.payableAmount,
          currency: intent.currency,
          operation: 'AUTHORIZE',
          status: 'CREATED',
          providerIdempotencyKey: idempotencyKey,
          requestPayload: { intentId, paymentMethodId },
        },
        tx,
      );

      // 7. Transition intent → PROCESSING (update payment_method_id)
      await tx
        .update(paymentIntents)
        .set({
          paymentMethodId,
          version: sql`${paymentIntents.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(paymentIntents.id, intentId));

      await this.stateTransitionService.transitionIntent(
        intentId,
        'PROCESSING',
        { correlationId, triggeredByType: 'USER' },
        undefined,
        tx,
      );

      // 8. Release transaction lock before calling provider (provider runs its own tx)
      // We perform provider call outside this transaction to avoid long locks
      // The status updates are committed in a new transaction below
    });

    // After the outer transaction commits, run the provider call
    await this.runProviderAuthorize(intentId, paymentMethodId, correlationId);
  }

  private async runProviderAuthorize(
    intentId: string,
    paymentMethodId: string,
    correlationId: string,
  ): Promise<void> {
    const intent = await this.dbService.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1)
      .then((r) => r[0]);

    if (!intent) return;

    const method = await this.paymentMethodsService.findById(paymentMethodId);
    if (!method) return;

    const customer = await this.customersService.findById(intent.customerId);
    if (!customer) return;

    const charge = await this.chargesService.findActiveByIntentAndOperation(
      intentId,
      'AUTHORIZE',
    );
    if (!charge) {
      // Charge may have already been updated if there was a race
      return;
    }

    const provider = this.providerRegistry.getProviderOrThrow(method.type);
    const idempotencyKey = this.chargesService.generateIdempotencyKey(charge.id, 'AUTHORIZE');

    let providerResult: Awaited<ReturnType<typeof provider.authorize>>;
    try {
      providerResult = await provider.authorize({
        chargeId: charge.id,
        intentId,
        paymentMethodId,
        customerId: customer.id,
        externalUserId: customer.externalUserId,
        amount: charge.amount,
        currency: charge.currency,
        idempotencyKey,
        correlationId,
        providerData: method.providerData as Record<string, unknown>,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Provider authorize threw: intentId=${intentId}, error=${message}`);
      await this.handleProviderFailure(intentId, charge.id, 'PROVIDER_EXCEPTION', message, correlationId);
      return;
    }

    if (providerResult.status === 'SUCCEEDED') {
      await this.handleAuthorizeSuccess(
        intent,
        charge.id,
        providerResult.providerTransactionId,
        providerResult.raw,
        customer.externalUserId,
        correlationId,
      );
    } else if (providerResult.status === 'PENDING') {
      await this.chargesService.updateStatus(charge.id, 'PENDING', {
        responsePayload: providerResult.raw,
      });
      // Intent stays PROCESSING
    } else if (providerResult.status === 'REQUIRES_ACTION') {
      await this.chargesService.updateStatus(charge.id, 'REQUIRES_ACTION', {
        responsePayload: providerResult.raw,
      });
      await this.stateTransitionService.transitionIntent(intentId, 'REQUIRES_ACTION', {
        correlationId,
        reasonCode: 'REQUIRES_ACTION',
      });
    } else {
      // FAILED
      await this.handleProviderFailure(
        intentId,
        charge.id,
        providerResult.errorCode ?? 'PROVIDER_FAILED',
        providerResult.errorMessage ?? 'Provider authorization failed',
        correlationId,
      );
    }
  }

  private async handleAuthorizeSuccess(
    intent: typeof paymentIntents.$inferSelect,
    chargeId: string,
    providerTransactionId: string | undefined,
    responsePayload: Record<string, unknown> | undefined,
    externalUserId: string,
    correlationId: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    await this.dbService.db.transaction(async (tx) => {
      // Update charge → SUCCEEDED
      await this.chargesService.updateStatus(
        chargeId,
        'SUCCEEDED',
        { providerTransactionId, responsePayload },
        tx,
      );

      // Transition intent → SUCCEEDED with outbox event
      await this.stateTransitionService.transitionIntent(
        intent.id,
        'SUCCEEDED',
        {
          correlationId,
          reasonCode: 'AUTHORIZE_SUCCEEDED',
          outboxEvent: {
            eventType: GatewayEventType.INTENT_SUCCEEDED,
            aggregateType: GATEWAY_AGGREGATE_TYPE,
            aggregateId: intent.id,
            payload: buildPaymentIntentEventPayload({
              intentId: intent.id,
              customerId: intent.customerId,
              externalUserId,
              status: 'SUCCEEDED',
              payableAmount: intent.payableAmount,
              currency: intent.currency,
              occurredAt: now,
            }),
          },
        },
        undefined,
        tx,
      );
    });
  }

  private async handleProviderFailure(
    intentId: string,
    chargeId: string,
    errorCode: string,
    errorMessage: string,
    correlationId: string,
  ): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      await this.chargesService.updateStatus(
        chargeId,
        'FAILED',
        { errorCode, errorMessage },
        tx,
      );

      // Back-transition intent → CREATED so caller can retry with different method
      await this.stateTransitionService.transitionIntent(
        intentId,
        'CREATED',
        {
          correlationId,
          reasonCode: 'CONFIRM_FAILED',
          reasonMessage: `Authorization failed: [${errorCode}] ${errorMessage}`,
        },
        undefined,
        tx,
      );
    });
  }

  private async cancelStaleCharge(
    chargeId: string,
    correlationId: string,
    tx: DbTx,
  ): Promise<void> {
    try {
      await this.chargesService.updateStatus(chargeId, 'CANCELED', {}, tx);
      await this.stateTransitionService.transitionCharge(
        chargeId,
        'CANCELED',
        { correlationId, reasonCode: 'STALE_CHARGE_CANCELED' },
        undefined,
        tx,
      );
    } catch (error) {
      this.logger.warn(`Failed to cancel stale charge ${chargeId}: ${error}`);
    }
  }

  private async lockIntent(
    intentId: string,
    tx: DbTx,
  ): Promise<typeof paymentIntents.$inferSelect | null> {
    const [row] = await tx.select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .for('update', { skipLocked: true })
      .limit(1);
    return row ?? null;
  }
}
