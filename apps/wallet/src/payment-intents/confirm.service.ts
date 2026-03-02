import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, sql } from 'drizzle-orm';
import { WalletSchema, paymentIntents } from '../schema';
import { Charge, DbTx } from '../types';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { ChargesService } from '../charges/charges.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';

type PaymentMode = 'points-only' | 'external-only' | 'composite';

interface Phase1Result {
  mode: PaymentMode;
  userId: string;
  currency: string;
  payableAmount: number;
  pointsChargeId: string | null;
  pointsAmount: number;
  externalMethodId: string | null;
  externalAmount: number;
}

@Injectable()
export class ConfirmService {
  private readonly logger = new Logger(ConfirmService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly chargesService: ChargesService,
    private readonly providerRegistry: ProviderRegistry,
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
    const existingActive = await this.chargesService.findActiveByIntentAndOperation(
      intentId,
      'AUTHORIZE',
      tx,
    );
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

    // 6. Determine mode
    const mode: PaymentMode =
      pointsAmount > 0 && externalAmount === 0
        ? 'points-only'
        : pointsAmount === 0
          ? 'external-only'
          : 'composite';

    // 7. Resolve method IDs
    // userId는 controller의 claimOrVerify에서 반드시 설정된 후 confirm이 호출되어야 함
    if (!intent.userId) {
      throw new BadRequestException({
        error: 'INTENT_NOT_CLAIMED',
        message: 'Intent must have an owner before confirmation',
      });
    }
    const intentUserId: string = intent.userId;

    let pointsMethodId: string | null = null;
    let externalMethodId: string | null = null;

    if (mode !== 'external-only') {
      const pointsMethod = await this.paymentMethodsService.findOrCreatePointsMethod(
        intentUserId,
        tx,
      );
      pointsMethodId = pointsMethod.id;
    }

    if (mode !== 'points-only') {
      const extMethod = await this.paymentMethodsService.findById(dto.paymentMethodId!, tx);
      if (!extMethod) {
        throw new NotFoundException({
          error: 'PAYMENT_METHOD_NOT_FOUND',
          message: `Payment method not found: ${dto.paymentMethodId}`,
        });
      }
      externalMethodId = extMethod.id;
    }

    // 8. Create charge(s)
    let pointsChargeId: string | null = null;

    if (mode !== 'external-only') {
      // composite or points-only: create POINTS charge now
      const idempotencyKey = `wallet:authorize:${intentId}:${pointsMethodId!}:${Date.now()}`;
      const pointsCharge = await this.chargesService.create(
        {
          intentId,
          paymentMethodId: pointsMethodId!,
          amount: pointsAmount,
          currency: intent.currency,
          operation: 'AUTHORIZE',
          status: 'CREATED',
          providerIdempotencyKey: idempotencyKey,
          requestPayload: { intentId, paymentMethodId: pointsMethodId! },
        },
        tx,
      );
      pointsChargeId = pointsCharge.id;
      // For composite: external charge is created in Phase 2b AFTER POINTS succeeds
      // (avoids unique constraint violation on active AUTHORIZE charges)
    } else {
      // external-only: create external charge now (same as original flow)
      const idempotencyKey = `wallet:authorize:${intentId}:${externalMethodId!}:${Date.now()}`;
      await this.chargesService.create(
        {
          intentId,
          paymentMethodId: externalMethodId!,
          amount: intent.payableAmount,
          currency: intent.currency,
          operation: 'AUTHORIZE',
          status: 'CREATED',
          providerIdempotencyKey: idempotencyKey,
          requestPayload: { intentId, paymentMethodId: externalMethodId! },
        },
        tx,
      );
    }

    // 9. Set intent.paymentMethodId and transition to PROCESSING
    // For composite/external-only: external method ID; for points-only: POINTS method ID
    const intentPaymentMethodId = externalMethodId ?? pointsMethodId!;
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
      mode,
      userId: intentUserId,
      currency: intent.currency,
      payableAmount: intent.payableAmount,
      pointsChargeId,
      pointsAmount,
      externalMethodId,
      externalAmount,
    };
  }

  private async phase2Execute(
    intentId: string,
    phase1: Phase1Result,
    correlationId: string,
  ): Promise<{ nextAction?: Record<string, unknown> }> {
    if (phase1.mode === 'external-only') {
      return this.runExternalAuthorize(intentId, phase1, correlationId);
    }

    // Phase 2a-1: Cancel any stale SUCCEEDED POINTS hold from a previous attempt
    await this.cancelSucceededPointsHold(
      intentId,
      phase1.userId,
      phase1.currency,
      correlationId,
    );

    // Phase 2a-2: Find the POINTS charge created in Phase 1 (still CREATED = active)
    const pointsCharge = await this.chargesService.findActiveByIntentAndOperation(
      intentId,
      'AUTHORIZE',
    );
    if (!pointsCharge) {
      this.logger.warn(`No active POINTS charge found for intent ${intentId}`);
      return {};
    }

    // Phase 2a-3: Run POINTS provider authorize (always synchronous: SUCCEEDED or FAILED)
    const pointsProvider = this.providerRegistry.getProviderOrThrow('POINTS');
    const pointsIdempotencyKey = this.chargesService.generateIdempotencyKey(
      pointsCharge.id,
      'AUTHORIZE',
    );

    let pointsResult: Awaited<ReturnType<typeof pointsProvider.authorize>>;
    try {
      pointsResult = await pointsProvider.authorize({
        chargeId: pointsCharge.id,
        intentId,
        paymentMethodId: pointsCharge.paymentMethodId,
        userId: phase1.userId,
        amount: pointsCharge.amount,
        currency: phase1.currency,
        idempotencyKey: pointsIdempotencyKey,
        correlationId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`POINTS authorize threw: intentId=${intentId}, error=${msg}`);
      await this.handleProviderFailure(
        intentId,
        pointsCharge.id,
        'PROVIDER_EXCEPTION',
        msg,
        correlationId,
      );
      return {};
    }

    if (pointsResult.status !== 'SUCCEEDED') {
      await this.handleProviderFailure(
        intentId,
        pointsCharge.id,
        pointsResult.errorCode ?? 'POINTS_FAILED',
        pointsResult.errorMessage ?? 'Points authorization failed',
        correlationId,
      );
      return {};
    }

    if (phase1.mode === 'points-only') {
      // Atomic: mark POINTS charge SUCCEEDED + intent → SUCCEEDED
      await this.handleFinalChargeSuccess(
        intentId,
        pointsCharge.id,
        pointsResult.providerTransactionId,
        pointsResult.raw,
        phase1,
        correlationId,
      );
      return {};
    }

    // Phase 2b: composite — POINTS succeeded, now create and run external charge
    // First mark POINTS charge as SUCCEEDED (standalone, not atomic with intent)
    await this.chargesService.updateStatus(pointsCharge.id, 'SUCCEEDED', {
      providerTransactionId: pointsResult.providerTransactionId,
      responsePayload: pointsResult.raw,
    });

    return this.runCompositeExternalLeg(intentId, phase1, correlationId);
  }

  private async runExternalAuthorize(
    intentId: string,
    phase1: Phase1Result,
    correlationId: string,
  ): Promise<{ nextAction?: Record<string, unknown> }> {
    const method = await this.paymentMethodsService.findById(phase1.externalMethodId!);
    if (!method) return {};

    const charge = await this.chargesService.findActiveByIntentAndOperation(
      intentId,
      'AUTHORIZE',
    );
    if (!charge) return {};

    const provider = this.providerRegistry.getProviderOrThrow(method.type);
    const idempotencyKey = this.chargesService.generateIdempotencyKey(charge.id, 'AUTHORIZE');

    let result: Awaited<ReturnType<typeof provider.authorize>>;
    try {
      result = await provider.authorize({
        chargeId: charge.id,
        intentId,
        paymentMethodId: method.id,
        userId: phase1.userId,
        amount: charge.amount,
        currency: charge.currency,
        idempotencyKey,
        correlationId,
        providerData: method.providerData as Record<string, unknown>,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Provider authorize threw: intentId=${intentId}, error=${msg}`);
      await this.handleProviderFailure(intentId, charge.id, 'PROVIDER_EXCEPTION', msg, correlationId);
      return {};
    }

    if (result.status === 'SUCCEEDED') {
      await this.handleFinalChargeSuccess(
        intentId,
        charge.id,
        result.providerTransactionId,
        result.raw,
        phase1,
        correlationId,
      );
      return {};
    } else if (result.status === 'PENDING') {
      await this.chargesService.updateStatus(charge.id, 'PENDING', {
        responsePayload: result.raw,
      });
      return {};
    } else if (result.status === 'REQUIRES_ACTION') {
      await this.chargesService.updateStatus(charge.id, 'REQUIRES_ACTION', {
        responsePayload: { ...(result.raw ?? {}), nextAction: result.nextAction },
      });
      await this.stateTransitionService.transitionIntent(intentId, 'REQUIRES_ACTION', {
        correlationId,
        reasonCode: 'REQUIRES_ACTION',
      });
      return { nextAction: result.nextAction };
    } else {
      await this.handleProviderFailure(
        intentId,
        charge.id,
        result.errorCode ?? 'PROVIDER_FAILED',
        result.errorMessage ?? 'Provider authorization failed',
        correlationId,
      );
      return {};
    }
  }

  private async runCompositeExternalLeg(
    intentId: string,
    phase1: Phase1Result,
    correlationId: string,
  ): Promise<{ nextAction?: Record<string, unknown> }> {
    // Create external charge in a new transaction
    // (POINTS charge is now SUCCEEDED — no active AUTHORIZE conflict)
    const externalCharge: Charge = await this.dbService.db.transaction(async (tx) => {
      const idempotencyKey = `wallet:authorize:${intentId}:${phase1.externalMethodId!}:ext:${Date.now()}`;
      return this.chargesService.create(
        {
          intentId,
          paymentMethodId: phase1.externalMethodId!,
          amount: phase1.externalAmount,
          currency: phase1.currency,
          operation: 'AUTHORIZE',
          status: 'CREATED',
          providerIdempotencyKey: idempotencyKey,
          requestPayload: { intentId, paymentMethodId: phase1.externalMethodId! },
        },
        tx,
      );
    });

    const method = await this.paymentMethodsService.findById(phase1.externalMethodId!);
    if (!method) return {};

    const provider = this.providerRegistry.getProviderOrThrow(method.type);
    const idempotencyKey = this.chargesService.generateIdempotencyKey(
      externalCharge.id,
      'AUTHORIZE',
    );

    let result: Awaited<ReturnType<typeof provider.authorize>>;
    try {
      result = await provider.authorize({
        chargeId: externalCharge.id,
        intentId,
        paymentMethodId: method.id,
        userId: phase1.userId,
        amount: externalCharge.amount,
        currency: externalCharge.currency,
        idempotencyKey,
        correlationId,
        providerData: method.providerData as Record<string, unknown>,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `External provider authorize threw: intentId=${intentId}, error=${msg}`,
      );
      await this.chargesService.updateStatus(externalCharge.id, 'FAILED', {
        errorCode: 'PROVIDER_EXCEPTION',
        errorMessage: msg,
      });
      await this.cancelSucceededPointsHold(
        intentId,
        phase1.userId,
        phase1.currency,
        correlationId,
      );
      await this.stateTransitionService.transitionIntent(intentId, 'CREATED', {
        correlationId,
        reasonCode: 'CONFIRM_FAILED',
        reasonMessage: `External authorization failed: PROVIDER_EXCEPTION: ${msg}`,
      });
      return {};
    }

    if (result.status === 'SUCCEEDED') {
      await this.handleFinalChargeSuccess(
        intentId,
        externalCharge.id,
        result.providerTransactionId,
        result.raw,
        phase1,
        correlationId,
      );
      return {};
    } else if (result.status === 'REQUIRES_ACTION') {
      await this.chargesService.updateStatus(externalCharge.id, 'REQUIRES_ACTION', {
        responsePayload: { ...(result.raw ?? {}), nextAction: result.nextAction },
      });
      await this.stateTransitionService.transitionIntent(intentId, 'REQUIRES_ACTION', {
        correlationId,
        reasonCode: 'REQUIRES_ACTION',
      });
      return { nextAction: result.nextAction };
    } else {
      // FAILED: cancel POINTS hold, intent → CREATED
      await this.chargesService.updateStatus(externalCharge.id, 'FAILED', {
        errorCode: result.errorCode ?? 'EXTERNAL_FAILED',
        errorMessage: result.errorMessage ?? 'External authorization failed',
        responsePayload: result.raw,
      });
      await this.cancelSucceededPointsHold(
        intentId,
        phase1.userId,
        phase1.currency,
        correlationId,
      );
      await this.stateTransitionService.transitionIntent(intentId, 'CREATED', {
        correlationId,
        reasonCode: 'CONFIRM_FAILED',
        reasonMessage: `External authorization failed: [${result.errorCode}] ${result.errorMessage}`,
      });
      return {};
    }
  }

  /** Atomically mark the final charge as SUCCEEDED and transition intent → SUCCEEDED */
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
      await this.chargesService.updateStatus(
        chargeId,
        'SUCCEEDED',
        { providerTransactionId, responsePayload },
        tx,
      );
      await this.stateTransitionService.transitionIntent(
        intentId,
        'SUCCEEDED',
        {
          correlationId,
          reasonCode: 'AUTHORIZE_SUCCEEDED',
          outboxEvent: {
            eventType: GatewayEventType.INTENT_SUCCEEDED,
            aggregateType: GATEWAY_AGGREGATE_TYPE,
            aggregateId: intentId,
            payload: buildPaymentIntentEventPayload({
              intentId,
              userId: phase1.userId,
              status: 'SUCCEEDED',
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
    _correlationId: string,
    tx: DbTx,
  ): Promise<void> {
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
    const stalePointsCharge =
      await this.chargesService.findSucceededPointsAuthorizeByIntent(intentId);
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
      this.logger.error(
        `Failed to cancel POINTS hold for intent ${intentId}: ${err}`,
      );
    }
  }

  private async lockIntent(
    intentId: string,
    tx: DbTx,
  ): Promise<typeof paymentIntents.$inferSelect | null> {
    const [row] = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .for('update', { skipLocked: true })
      .limit(1);
    return row ?? null;
  }
}
