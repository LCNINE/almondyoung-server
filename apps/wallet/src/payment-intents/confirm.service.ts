import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, sql } from 'drizzle-orm';
import { WalletSchema, paymentIntents } from '../schema';
import { Charge, DbTx } from '../types';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { ChargesService } from '../charges/charges.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { AutoCaptureService } from './auto-capture.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';
import { ChargePlan, ChargeSlot } from './charge-plan';
import { ChargeResult } from '../providers/payment-provider.interface';

interface Phase1Result {
  plan: ChargePlan;
  userId: string;
  currency: string;
  payableAmount: number;
  metadata: Record<string, unknown>;
  /** charge ID for the discount slot (if present) */
  discountChargeId: string | null;
  /** charge ID for the primary slot */
  primaryChargeId: string;
}

@Injectable()
export class ConfirmService {
  private readonly logger = new Logger(ConfirmService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly chargesService: ChargesService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly autoCaptureService: AutoCaptureService,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async confirm(
    intentId: string,
    dto: { paymentMethodId?: string; pointsToApply?: number },
    correlationId: string,
  ): Promise<{ nextAction?: Record<string, unknown> }> {
    let phase1: Phase1Result | null = null;

    await this.dbService.db.transaction(async (tx) => {
      phase1 = await this.phase1Setup(intentId, dto, correlationId, tx);
    });

    if (!phase1) return {};
    return this.phase2Execute(intentId, phase1, correlationId);
  }

  // ─── Phase 1: transactional setup ──────────────────────────────────────────

  private async phase1Setup(
    intentId: string,
    dto: { paymentMethodId?: string; pointsToApply?: number },
    correlationId: string,
    tx: DbTx,
  ): Promise<Phase1Result> {
    // 1. Lock intent
    const intent = await this.lockIntent(intentId, tx);
    if (!intent) {
      throw new NotFoundException({
        error: 'INTENT_NOT_FOUND',
        message: `Payment intent not found: ${intentId}`,
      });
    }

    // 2. Validate status
    const allowedStatuses = ['CREATED', 'PROCESSING', 'REQUIRES_ACTION'] as const;
    if (!allowedStatuses.includes(intent.status as (typeof allowedStatuses)[number])) {
      throw new ConflictException({
        error: 'INTENT_STATUS_INVALID',
        message: `Intent cannot be confirmed in status: ${intent.status}`,
      });
    }

    // 3. Cancel any active AUTHORIZE charge (stale from previous attempt)
    const existingActive = await this.chargesService.findActiveByIntentAndOperation(intentId, 'AUTHORIZE', tx);
    if (existingActive) {
      await this.cancelStaleCharge(existingActive.id, correlationId, tx);
    }

    // 4. Calculate amounts
    const pointsToApply = dto.pointsToApply ?? 0;
    const pointsAmount = Math.min(pointsToApply, intent.payableAmount);
    const externalAmount = intent.payableAmount - pointsAmount;

    // 5. Validate
    if (externalAmount > 0 && !dto.paymentMethodId) {
      throw new BadRequestException({
        error: 'PAYMENT_METHOD_REQUIRED',
        message: 'A payment method ID is required when points do not cover the full amount',
      });
    }

    // 6. userId check
    if (!intent.userId) {
      throw new BadRequestException({
        error: 'INTENT_NOT_CLAIMED',
        message: 'Intent must have an owner before confirmation',
      });
    }
    const intentUserId: string = intent.userId;

    // 6.5. Release any stale SUCCEEDED POINTS hold left by a previous attempt.
    //      Unconditional: it must NOT depend on this retry re-applying points,
    //      otherwise an abandoned composite attempt (POINTS + Toss) leaks its
    //      points hold whenever the UI shows 0 available points and hides reuse.
    await this.cancelSucceededPointsHold(intentId, intentUserId, intent.currency, correlationId);

    // 7. Build ChargePlan
    const plan = await this.buildChargePlan(intentUserId, pointsAmount, externalAmount, dto.paymentMethodId, tx);

    // 8. Create charge records
    let discountChargeId: string | null = null;

    if (plan.discount) {
      const idempotencyKey = `wallet:authorize:${intentId}:${plan.discount.paymentMethodId}:${Date.now()}`;
      const discountCharge = await this.chargesService.create(
        {
          intentId,
          paymentMethodId: plan.discount.paymentMethodId,
          amount: plan.discount.amount,
          currency: intent.currency,
          operation: 'AUTHORIZE',
          status: 'CREATED',
          providerIdempotencyKey: idempotencyKey,
          requestPayload: { intentId, paymentMethodId: plan.discount.paymentMethodId },
        },
        tx,
      );
      discountChargeId = discountCharge.id;
    }

    // Primary charge: created now only when there is no discount slot
    // (when discount exists, primary charge is created in Phase 2 AFTER discount succeeds)
    let primaryChargeId: string;
    if (!plan.discount) {
      const idempotencyKey = `wallet:authorize:${intentId}:${plan.primary.paymentMethodId}:${Date.now()}`;
      const primaryCharge = await this.chargesService.create(
        {
          intentId,
          paymentMethodId: plan.primary.paymentMethodId,
          amount: plan.primary.amount,
          currency: intent.currency,
          operation: 'AUTHORIZE',
          status: 'CREATED',
          providerIdempotencyKey: idempotencyKey,
          requestPayload: { intentId, paymentMethodId: plan.primary.paymentMethodId },
        },
        tx,
      );
      primaryChargeId = primaryCharge.id;
    } else {
      // placeholder — will be created in phase2 after discount succeeds
      primaryChargeId = '';
    }

    // 9. Set intent.paymentMethodId and transition to PROCESSING
    const intentPaymentMethodId = plan.primary.paymentMethodId;
    await tx
      .update(paymentIntents)
      .set({
        paymentMethodId: intentPaymentMethodId,
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

    return {
      plan,
      userId: intentUserId,
      currency: intent.currency,
      payableAmount: intent.payableAmount,
      metadata: intent.metadata ?? {},
      discountChargeId,
      primaryChargeId,
    };
  }

  // ─── ChargePlan builder ────────────────────────────────────────────────────

  private async buildChargePlan(
    userId: string,
    pointsAmount: number,
    externalAmount: number,
    externalMethodId: string | undefined,
    tx: DbTx,
  ): Promise<ChargePlan> {
    // Points-only → primary = Points, no discount
    if (pointsAmount > 0 && externalAmount === 0) {
      const pointsMethod = await this.paymentMethodsService.findOrCreatePointsMethod(userId, tx);
      const pointsProvider = this.providerRegistry.getProviderOrThrow('POINTS');
      return {
        primary: { provider: pointsProvider, paymentMethodId: pointsMethod.id, amount: pointsAmount },
      };
    }

    // External-only → primary = external, no discount
    if (pointsAmount === 0 && externalAmount > 0) {
      const extMethod = await this.resolveExternalMethod(externalMethodId!);
      const extProvider = this.providerRegistry.getProviderOrThrow(extMethod.type);
      return {
        primary: { provider: extProvider, paymentMethodId: extMethod.id, amount: externalAmount },
      };
    }

    // Composite → discount = Points, primary = external
    const pointsMethod = await this.paymentMethodsService.findOrCreatePointsMethod(userId, tx);
    const pointsProvider = this.providerRegistry.getProviderOrThrow('POINTS');
    const extMethod = await this.resolveExternalMethod(externalMethodId!);
    const extProvider = this.providerRegistry.getProviderOrThrow(extMethod.type);

    return {
      discount: { provider: pointsProvider, paymentMethodId: pointsMethod.id, amount: pointsAmount },
      primary: { provider: extProvider, paymentMethodId: extMethod.id, amount: externalAmount },
    };
  }

  private async resolveExternalMethod(methodId: string) {
    const method = await this.paymentMethodsService.findById(methodId);
    if (!method) {
      throw new NotFoundException({
        error: 'PAYMENT_METHOD_NOT_FOUND',
        message: `Payment method not found: ${methodId}`,
      });
    }
    return method;
  }

  // ─── Phase 2: execute slot pipeline ────────────────────────────────────────

  private async phase2Execute(
    intentId: string,
    phase1: Phase1Result,
    correlationId: string,
  ): Promise<{ nextAction?: Record<string, unknown> }> {
    const { plan } = phase1;

    // Step 1: Discount slot (if present)
    if (plan.discount && phase1.discountChargeId) {
      // Cancel any stale SUCCEEDED POINTS hold from a previous attempt
      await this.cancelSucceededPointsHold(intentId, phase1.userId, phase1.currency, correlationId);

      const discountResult = await this.authorizeSlot(
        intentId,
        phase1.discountChargeId,
        plan.discount,
        phase1.userId,
        phase1.currency,
        correlationId,
      );

      if (discountResult.status !== 'SUCCEEDED') {
        // discount failed → no need to cancel discount, just fail the intent
        await this.handleProviderFailure(
          intentId,
          phase1.discountChargeId,
          discountResult.errorCode ?? 'DISCOUNT_FAILED',
          discountResult.errorMessage ?? 'Discount authorization failed',
          correlationId,
        );
        return {};
      }

      // Mark discount charge as SUCCEEDED
      await this.chargesService.updateStatus(phase1.discountChargeId, 'SUCCEEDED', {
        providerTransactionId: discountResult.providerTransactionId,
        responsePayload: discountResult.raw,
      });
    }

    // Step 2: Primary slot
    // If discount was present, create primary charge now (deferred to avoid unique constraint)
    let primaryChargeId = phase1.primaryChargeId;
    if (plan.discount) {
      const primaryCharge = await this.dbService.db.transaction(async (tx) => {
        const idempotencyKey = `wallet:authorize:${intentId}:${plan.primary.paymentMethodId}:ext:${Date.now()}`;
        return this.chargesService.create(
          {
            intentId,
            paymentMethodId: plan.primary.paymentMethodId,
            amount: plan.primary.amount,
            currency: phase1.currency,
            operation: 'AUTHORIZE',
            status: 'CREATED',
            providerIdempotencyKey: idempotencyKey,
            requestPayload: { intentId, paymentMethodId: plan.primary.paymentMethodId },
          },
          tx,
        );
      });
      primaryChargeId = primaryCharge.id;
    }

    const primaryResult = await this.authorizeSlot(
      intentId,
      primaryChargeId,
      plan.primary,
      phase1.userId,
      phase1.currency,
      correlationId,
      phase1.metadata,
    );

    return this.handlePrimaryResult(intentId, primaryChargeId, primaryResult, phase1, correlationId);
  }

  // ─── Slot authorize ────────────────────────────────────────────────────────

  private async authorizeSlot(
    intentId: string,
    chargeId: string,
    slot: ChargeSlot,
    userId: string,
    currency: string,
    correlationId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ChargeResult> {
    const idempotencyKey = this.chargesService.generateIdempotencyKey(chargeId, 'AUTHORIZE');

    const method = await this.paymentMethodsService.findById(slot.paymentMethodId);

    try {
      return await slot.provider.authorize({
        chargeId,
        intentId,
        paymentMethodId: slot.paymentMethodId,
        userId,
        amount: slot.amount,
        currency,
        idempotencyKey,
        correlationId,
        providerData: method?.providerData,
        metadata,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Provider authorize threw: intentId=${intentId}, chargeId=${chargeId}, error=${msg}`);
      return { status: 'FAILED', errorCode: 'PROVIDER_EXCEPTION', errorMessage: msg };
    }
  }

  // ─── Primary result handling ───────────────────────────────────────────────

  private async handlePrimaryResult(
    intentId: string,
    primaryChargeId: string,
    result: ChargeResult,
    phase1: Phase1Result,
    correlationId: string,
  ): Promise<{ nextAction?: Record<string, unknown> }> {
    switch (result.status) {
      case 'SUCCEEDED':
        await this.handleFinalChargeSuccess(intentId, primaryChargeId, result.providerTransactionId, result.raw, phase1, correlationId);
        return {};

      case 'PENDING':
        // CMS 등 배치 결제: charge → PENDING, intent → PENDING_SETTLEMENT
        await this.chargesService.updateStatus(primaryChargeId, 'PENDING', {
          responsePayload: result.raw,
        });
        await this.stateTransitionService.transitionIntent(intentId, 'PENDING_SETTLEMENT', {
          correlationId,
          reasonCode: 'PENDING_SETTLEMENT',
          reasonMessage: 'Awaiting external settlement result',
        });
        return {};

      case 'REQUIRES_ACTION':
        await this.chargesService.updateStatus(primaryChargeId, 'REQUIRES_ACTION', {
          responsePayload: { ...(result.raw ?? {}), nextAction: result.nextAction },
        });
        await this.stateTransitionService.transitionIntent(intentId, 'REQUIRES_ACTION', {
          correlationId,
          reasonCode: 'REQUIRES_ACTION',
        });
        return { nextAction: result.nextAction };

      default: {
        // FAILED
        await this.chargesService.updateStatus(primaryChargeId, 'FAILED', {
          errorCode: result.errorCode ?? 'PROVIDER_FAILED',
          errorMessage: result.errorMessage ?? 'Provider authorization failed',
          responsePayload: result.raw,
        });

        // If there was a discount slot, cancel the points hold
        if (phase1.plan.discount) {
          await this.cancelSucceededPointsHold(intentId, phase1.userId, phase1.currency, correlationId);
        }

        await this.stateTransitionService.transitionIntent(intentId, 'CREATED', {
          correlationId,
          reasonCode: 'CONFIRM_FAILED',
          reasonMessage: `Primary authorization failed: [${result.errorCode}] ${result.errorMessage}`,
        });
        return {};
      }
    }
  }

  // ─── Final success: charge SUCCEEDED + intent → AUTHORIZED ─────────────────

  private async handleFinalChargeSuccess(
    intentId: string,
    chargeId: string,
    providerTransactionId: string | undefined,
    responsePayload: Record<string, unknown> | undefined,
    phase1: Phase1Result,
    correlationId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.dbService.db.transaction(async (tx) => {
      await this.chargesService.updateStatus(chargeId, 'SUCCEEDED', { providerTransactionId, responsePayload }, tx);
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
              userId: phase1.userId,
              status: 'AUTHORIZED',
              payableAmount: phase1.payableAmount,
              currency: phase1.currency,
              occurredAt: now,
            }),
          },
        },
        undefined,
        tx,
      );
    });

    await this.autoCaptureService.attemptAutoCapture(intentId, correlationId);
  }

  // ─── Failure / cleanup helpers ─────────────────────────────────────────────

  private async handleProviderFailure(
    intentId: string,
    chargeId: string,
    errorCode: string,
    errorMessage: string,
    correlationId: string,
  ): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      await this.chargesService.updateStatus(chargeId, 'FAILED', { errorCode, errorMessage }, tx);
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

  private async cancelStaleCharge(chargeId: string, _correlationId: string, tx: DbTx): Promise<void> {
    try {
      await this.chargesService.updateStatus(chargeId, 'CANCELED', {}, tx);
    } catch (err) {
      this.logger.warn(`Failed to cancel stale charge ${chargeId}: ${err}`);
    }
  }

  /** Cancel a SUCCEEDED POINTS AUTHORIZE hold (best-effort, for stale/failed composite holds) */
  async cancelSucceededPointsHold(
    intentId: string,
    userId: string,
    currency: string,
    correlationId: string,
  ): Promise<void> {
    const stalePointsCharge = await this.chargesService.findSucceededPointsAuthorizeByIntent(intentId);
    if (!stalePointsCharge) return;

    const pointsProvider = this.providerRegistry.getProviderOrThrow('POINTS');
    try {
      await pointsProvider.cancel({
        chargeId: stalePointsCharge.id,
        intentId,
        paymentMethodId: stalePointsCharge.paymentMethodId,
        userId,
        amount: stalePointsCharge.amount,
        currency,
        idempotencyKey: `wallet:cancel:points:${stalePointsCharge.id}:${correlationId}`,
        correlationId,
      });
      await this.chargesService.updateStatus(stalePointsCharge.id, 'CANCELED', {});
    } catch (err) {
      this.logger.error(`Failed to cancel POINTS hold for intent ${intentId}: ${err}`);
    }
  }

  private async lockIntent(intentId: string, tx: DbTx): Promise<typeof paymentIntents.$inferSelect | null> {
    const [row] = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .for('update', { skipLocked: true })
      .limit(1);
    return row ?? null;
  }
}
