import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, sql } from 'drizzle-orm';
import {
  PaymentIntentStatus,
  PaymentLegStatus,
  PaymentReferenceType,
  WalletSchema,
  paymentAttempts,
  paymentIntents,
  paymentLegs,
} from '../../schema';
import { DbTx, PaymentAttempt } from '../../types';
import { ProviderRegistry } from '../../providers/provider.registry';
import {
  ProviderOperation,
  ProviderOperationResult,
} from '../../providers/payment-provider.types';
import { StateTransitionService } from '../../domain/state-transition/state-transition.service';
import { buildPaymentIntentEventPayload } from '../../messaging/payments-event.builder';
import { AttemptService } from '../support/attempt.service';
import { LegOperationResult } from './intents.service.types';

interface OutboxEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  partitionKey?: string;
  payload: Record<string, unknown>;
}

interface PaymentIntentEventSource {
  id: string;
  referenceType: PaymentReferenceType;
  referenceId: string;
  customerId: string;
  payableAmount: number;
  currency: string;
}

interface LockedIntent {
  id: string;
  referenceType: PaymentReferenceType;
  referenceId: string;
  customerId: string;
  currency: string;
  payableAmount: number;
  expiresAt: Date;
  status: PaymentIntentStatus;
  version: number;
}

interface LockedLeg {
  id: string;
  intentId: string;
  providerType: string;
  amount: number;
  status: PaymentLegStatus;
  version: number;
  metadata: Record<string, unknown>;
}

@Injectable()
export class LegExecutionService {
  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly providerRegistry: ProviderRegistry,
    private readonly stateTransitionService: StateTransitionService,
    private readonly attemptService: AttemptService,
  ) {}

  async authorizeLeg(
    intentId: string,
    legId: string,
    correlationId?: string,
  ): Promise<LegOperationResult> {
    const requestCorrelationId = correlationId?.trim() || randomUUID();

    const prepared = await this.dbService.db.transaction(async (tx) => {
      const intent = await this.lockIntentOrThrow(intentId, tx);
      this.assertIntentCanExecuteLeg(intent.status);

      const leg = await this.lockLegOrThrow(intentId, legId, tx);
      this.assertLegStatus(leg.status, 'READY', legId, 'authorize');

      this.providerRegistry.assertCapability(leg.providerType, 'AUTHORIZE', {
        intentId,
        legId,
      });

      const attempt = await this.createAttempt(tx, {
        intentId,
        legId,
        operation: 'AUTHORIZE',
        correlationId: requestCorrelationId,
        triggeredById: intent.customerId,
      });

      if (intent.status === 'PENDING') {
        await this.stateTransitionService.transitionIntent(
          intentId,
          'IN_PROGRESS',
          {
            correlationId: requestCorrelationId,
            causationId: attempt.id,
            reasonCode: 'LEG_AUTHORIZE_STARTED',
            reasonMessage: `Leg authorize started for leg=${legId}`,
            triggeredByType: 'SYSTEM',
            triggeredById: intent.customerId,
            payload: {
              legId,
              operation: 'AUTHORIZE',
            },
          },
          'PENDING',
          tx,
        );
      }

      await this.stateTransitionService.transitionLeg(
        legId,
        'PROCESSING',
        {
          correlationId: requestCorrelationId,
          causationId: attempt.id,
          reasonCode: 'LEG_AUTHORIZE_STARTED',
          reasonMessage: 'Leg moved to PROCESSING before provider authorize',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            operation: 'AUTHORIZE',
          },
        },
        'READY',
        tx,
      );

      await this.stateTransitionService.transitionAttempt(
        attempt.id,
        'SENT',
        {
          correlationId: requestCorrelationId,
          causationId: legId,
          reasonCode: 'PROVIDER_AUTHORIZE_REQUEST_SENT',
          reasonMessage: 'Provider authorize request sent',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            providerType: leg.providerType,
            operation: 'AUTHORIZE',
          },
        },
        'CREATED',
        tx,
      );

      return { intent, leg, attempt };
    });

    const provider = this.providerRegistry.assertCapability(
      prepared.leg.providerType,
      'AUTHORIZE',
      {
        intentId,
        legId,
      },
    );

    try {
      const providerResult = await provider.execute({
        op: 'AUTHORIZE',
        params: {
          intentId,
          legId,
          attemptId: prepared.attempt.id,
          idempotencyKey: prepared.attempt.providerIdempotencyKey,
          amount: prepared.leg.amount,
          currency: prepared.intent.currency,
          customerId: prepared.intent.customerId,
          correlationId: requestCorrelationId,
          metadata: prepared.leg.metadata,
        },
      });

      return this.dbService.db.transaction(async (tx) => {
        await this.persistProviderAttemptResult(tx, prepared.attempt.id, providerResult);
        await this.applyAuthorizeResult(
          tx,
          {
            intentId,
            legId,
            attemptId: prepared.attempt.id,
            customerId: prepared.intent.customerId,
          },
          providerResult,
          requestCorrelationId,
        );
        return this.readLegOperationResult(tx, intentId, legId, prepared.attempt.id);
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Provider authorize call failed';

      return this.dbService.db.transaction(async (tx) => {
        await this.persistProviderAttemptFailure(
          tx,
          prepared.attempt.id,
          'PROVIDER_AUTHORIZE_FAILED',
          errorMessage,
        );
        await this.stateTransitionService.transitionAttempt(
          prepared.attempt.id,
          'FAILED_RETRYABLE',
          {
            correlationId: requestCorrelationId,
            causationId: legId,
            reasonCode: 'PROVIDER_AUTHORIZE_FAILED',
            reasonMessage: errorMessage,
            triggeredByType: 'SYSTEM',
            triggeredById: prepared.intent.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'SENT',
          tx,
        );
        await this.stateTransitionService.transitionLeg(
          legId,
          'FAILED',
          {
            correlationId: requestCorrelationId,
            causationId: prepared.attempt.id,
            reasonCode: 'PROVIDER_AUTHORIZE_FAILED',
            reasonMessage: errorMessage,
            triggeredByType: 'SYSTEM',
            triggeredById: prepared.intent.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'PROCESSING',
          tx,
        );

        return this.readLegOperationResult(tx, intentId, legId, prepared.attempt.id);
      });
    }
  }

  async captureLeg(
    intentId: string,
    legId: string,
    correlationId?: string,
  ): Promise<LegOperationResult> {
    const requestCorrelationId = correlationId?.trim() || randomUUID();

    const prepared = await this.dbService.db.transaction(async (tx) => {
      const intent = await this.lockIntentOrThrow(intentId, tx);
      this.assertIntentCanExecuteLeg(intent.status);

      const leg = await this.lockLegOrThrow(intentId, legId, tx);
      this.assertLegStatus(leg.status, 'AUTHORIZED', legId, 'capture');

      this.providerRegistry.assertCapability(leg.providerType, 'CAPTURE', {
        intentId,
        legId,
      });

      const attempt = await this.createAttempt(tx, {
        intentId,
        legId,
        operation: 'CAPTURE',
        correlationId: requestCorrelationId,
        triggeredById: intent.customerId,
      });

      await this.stateTransitionService.transitionAttempt(
        attempt.id,
        'SENT',
        {
          correlationId: requestCorrelationId,
          causationId: legId,
          reasonCode: 'PROVIDER_CAPTURE_REQUEST_SENT',
          reasonMessage: 'Provider capture request sent',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            providerType: leg.providerType,
            operation: 'CAPTURE',
          },
        },
        'CREATED',
        tx,
      );

      return { intent, leg, attempt };
    });

    const provider = this.providerRegistry.assertCapability(
      prepared.leg.providerType,
      'CAPTURE',
      {
        intentId,
        legId,
      },
    );

    try {
      const providerResult = await provider.execute({
        op: 'CAPTURE',
        params: {
          intentId,
          legId,
          attemptId: prepared.attempt.id,
          idempotencyKey: prepared.attempt.providerIdempotencyKey,
          amount: prepared.leg.amount,
          currency: prepared.intent.currency,
          customerId: prepared.intent.customerId,
          correlationId: requestCorrelationId,
          metadata: prepared.leg.metadata,
        },
      });

      return this.dbService.db.transaction(async (tx) => {
        await this.persistProviderAttemptResult(tx, prepared.attempt.id, providerResult);

        if (providerResult.resultStatus === 'CAPTURED') {
          await this.stateTransitionService.transitionAttempt(
            prepared.attempt.id,
            'CAPTURED',
            {
              correlationId: requestCorrelationId,
              causationId: legId,
              reasonCode: 'PROVIDER_CAPTURE_SUCCEEDED',
              reasonMessage: 'Provider capture succeeded',
              triggeredByType: 'SYSTEM',
              triggeredById: prepared.intent.customerId,
              payload: {
                operation: 'CAPTURE',
              },
            },
            'SENT',
            tx,
          );

          await this.stateTransitionService.transitionLeg(
            legId,
            'CAPTURED',
            {
              correlationId: requestCorrelationId,
              causationId: prepared.attempt.id,
              reasonCode: 'LEG_CAPTURED',
              reasonMessage: 'Leg capture completed',
              triggeredByType: 'SYSTEM',
              triggeredById: prepared.intent.customerId,
              payload: {
                operation: 'CAPTURE',
              },
            },
            'AUTHORIZED',
            tx,
          );

          await this.reconcileIntentAfterCapture(
            intentId,
            requestCorrelationId,
            prepared.attempt.id,
            tx,
          );
        } else {
          await this.persistProviderAttemptFailure(
            tx,
            prepared.attempt.id,
            'PROVIDER_CAPTURE_FAILED',
            `Unexpected provider capture result: ${providerResult.resultStatus}`,
          );
          await this.stateTransitionService.transitionAttempt(
            prepared.attempt.id,
            'FAILED_FINAL',
            {
              correlationId: requestCorrelationId,
              causationId: legId,
              reasonCode: 'PROVIDER_CAPTURE_FAILED',
              reasonMessage: `Unexpected provider capture result: ${providerResult.resultStatus}`,
              triggeredByType: 'SYSTEM',
              triggeredById: prepared.intent.customerId,
              payload: {
                operation: 'CAPTURE',
                providerResultStatus: providerResult.resultStatus,
              },
            },
            'SENT',
            tx,
          );
        }

        return this.readLegOperationResult(tx, intentId, legId, prepared.attempt.id);
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Provider capture call failed';

      return this.dbService.db.transaction(async (tx) => {
        await this.persistProviderAttemptFailure(
          tx,
          prepared.attempt.id,
          'PROVIDER_CAPTURE_UNCERTAIN',
          errorMessage,
        );
        await this.stateTransitionService.transitionAttempt(
          prepared.attempt.id,
          'PENDING_PROVIDER',
          {
            correlationId: requestCorrelationId,
            causationId: legId,
            reasonCode: 'PROVIDER_CAPTURE_UNCERTAIN',
            reasonMessage: `Capture result uncertain, reconcile required: ${errorMessage}`,
            triggeredByType: 'SYSTEM',
            triggeredById: prepared.intent.customerId,
            payload: {
              operation: 'CAPTURE',
              uncertainFailure: true,
            },
          },
          'SENT',
          tx,
        );

        return this.readLegOperationResult(tx, intentId, legId, prepared.attempt.id);
      });
    }
  }

  private async applyAuthorizeResult(
    tx: DbTx,
    context: {
      intentId: string;
      legId: string;
      attemptId: string;
      customerId: string;
    },
    providerResult: ProviderOperationResult,
    correlationId: string,
  ): Promise<void> {
    switch (providerResult.resultStatus) {
      case 'AUTHORIZED': {
        await this.stateTransitionService.transitionAttempt(
          context.attemptId,
          'AUTHORIZED',
          {
            correlationId,
            causationId: context.legId,
            reasonCode: 'PROVIDER_AUTHORIZE_SUCCEEDED',
            reasonMessage: 'Provider authorize succeeded',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'SENT',
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          context.legId,
          'AUTHORIZED',
          {
            correlationId,
            causationId: context.attemptId,
            reasonCode: 'LEG_AUTHORIZED',
            reasonMessage: 'Leg authorize completed',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'PROCESSING',
          tx,
        );
        return;
      }
      case 'CAPTURED': {
        await this.stateTransitionService.transitionAttempt(
          context.attemptId,
          'CAPTURED',
          {
            correlationId,
            causationId: context.legId,
            reasonCode: 'PROVIDER_AUTHORIZE_CAPTURED',
            reasonMessage: 'Provider authorize returned captured',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'SENT',
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          context.legId,
          'AUTHORIZED',
          {
            correlationId,
            causationId: context.attemptId,
            reasonCode: 'LEG_AUTHORIZED',
            reasonMessage: 'Authorize step completed before auto-capture',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'PROCESSING',
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          context.legId,
          'CAPTURED',
          {
            correlationId,
            causationId: context.attemptId,
            reasonCode: 'LEG_CAPTURED',
            reasonMessage: 'Authorize path auto-captured leg',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
              autoCaptured: true,
            },
          },
          'AUTHORIZED',
          tx,
        );

        await this.reconcileIntentAfterCapture(
          context.intentId,
          correlationId,
          context.attemptId,
          tx,
        );
        return;
      }
      case 'REQUIRES_CUSTOMER_ACTION': {
        await this.stateTransitionService.transitionAttempt(
          context.attemptId,
          'REQUIRES_ACTION',
          {
            correlationId,
            causationId: context.legId,
            reasonCode: 'PROVIDER_AUTHORIZE_REQUIRES_ACTION',
            reasonMessage: 'Provider authorize requires customer action',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
              nextAction: providerResult.nextAction ?? null,
            },
          },
          'SENT',
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          context.legId,
          'REQUIRES_CUSTOMER_ACTION',
          {
            correlationId,
            causationId: context.attemptId,
            reasonCode: 'LEG_REQUIRES_CUSTOMER_ACTION',
            reasonMessage: 'Leg requires customer action',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
              nextAction: providerResult.nextAction ?? null,
            },
          },
          'PROCESSING',
          tx,
        );
        return;
      }
      case 'REQUIRES_ADMIN_CONFIRMATION': {
        await this.stateTransitionService.transitionAttempt(
          context.attemptId,
          'REQUIRES_ACTION',
          {
            correlationId,
            causationId: context.legId,
            reasonCode: 'PROVIDER_AUTHORIZE_REQUIRES_ADMIN_CONFIRMATION',
            reasonMessage: 'Provider authorize requires admin confirmation',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'SENT',
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          context.legId,
          'REQUIRES_ADMIN_CONFIRMATION',
          {
            correlationId,
            causationId: context.attemptId,
            reasonCode: 'LEG_REQUIRES_ADMIN_CONFIRMATION',
            reasonMessage: 'Leg requires admin confirmation',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'PROCESSING',
          tx,
        );
        return;
      }
      case 'FAILED':
      default: {
        await this.persistProviderAttemptFailure(
          tx,
          context.attemptId,
          'PROVIDER_AUTHORIZE_FAILED',
          `Provider authorize returned failed status: ${providerResult.resultStatus}`,
        );

        await this.stateTransitionService.transitionAttempt(
          context.attemptId,
          'FAILED_FINAL',
          {
            correlationId,
            causationId: context.legId,
            reasonCode: 'PROVIDER_AUTHORIZE_FAILED',
            reasonMessage: `Provider authorize returned failed status: ${providerResult.resultStatus}`,
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
              providerResultStatus: providerResult.resultStatus,
            },
          },
          'SENT',
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          context.legId,
          'FAILED',
          {
            correlationId,
            causationId: context.attemptId,
            reasonCode: 'PROVIDER_AUTHORIZE_FAILED',
            reasonMessage: 'Leg authorize failed',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'PROCESSING',
          tx,
        );
      }
    }
  }

  private async reconcileIntentAfterCapture(
    intentId: string,
    correlationId: string,
    causationId: string,
    tx: DbTx,
  ): Promise<void> {
    const intent = await this.lockIntentOrThrow(intentId, tx);
    const legRows = await tx
      .select({
        status: paymentLegs.status,
        isRequired: paymentLegs.isRequired,
      })
      .from(paymentLegs)
      .where(eq(paymentLegs.intentId, intentId));

    const requiredLegs = legRows.filter((row) => row.isRequired);
    const hasCapturedLeg = legRows.some((row) => row.status === 'CAPTURED');

    if (!hasCapturedLeg) {
      return;
    }

    const allRequiredCaptured =
      requiredLegs.length > 0 &&
      requiredLegs.every((row) => row.status === 'CAPTURED');

    if (allRequiredCaptured) {
      if (intent.status === 'PENDING') {
        await this.stateTransitionService.transitionIntent(
          intentId,
          'IN_PROGRESS',
          {
            correlationId,
            causationId,
            reasonCode: 'INTENT_CAPTURE_PROGRESS',
            reasonMessage: 'Intent moved to IN_PROGRESS before success',
            triggeredByType: 'SYSTEM',
            triggeredById: intent.customerId,
            payload: {
              reason: 'capture',
            },
          },
          'PENDING',
          tx,
        );
      }

      if (intent.status === 'IN_PROGRESS' || intent.status === 'PARTIALLY_CAPTURED') {
        await this.stateTransitionService.transitionIntent(
          intentId,
          'SUCCEEDED',
          {
            correlationId,
            causationId,
            reasonCode: 'INTENT_CAPTURE_SUCCEEDED',
            reasonMessage: 'All required legs captured',
            triggeredByType: 'SYSTEM',
            triggeredById: intent.customerId,
            payload: {
              reason: 'all_required_legs_captured',
            },
            outboxEvent: this.buildPaymentIntentOutboxEvent(
              intent,
              'PaymentIntentSucceeded',
              'SUCCEEDED',
            ),
          },
          intent.status,
          tx,
        );
      }

      if (intent.status === 'PENDING') {
        await this.stateTransitionService.transitionIntent(
          intentId,
          'SUCCEEDED',
          {
            correlationId,
            causationId,
            reasonCode: 'INTENT_CAPTURE_SUCCEEDED',
            reasonMessage: 'All required legs captured',
            triggeredByType: 'SYSTEM',
            triggeredById: intent.customerId,
            payload: {
              reason: 'all_required_legs_captured',
            },
            outboxEvent: this.buildPaymentIntentOutboxEvent(
              intent,
              'PaymentIntentSucceeded',
              'SUCCEEDED',
            ),
          },
          'IN_PROGRESS',
          tx,
        );
      }

      return;
    }

    if (intent.status === 'PENDING') {
      await this.stateTransitionService.transitionIntent(
        intentId,
        'IN_PROGRESS',
        {
          correlationId,
          causationId,
          reasonCode: 'INTENT_CAPTURE_PROGRESS',
          reasonMessage: 'Intent moved to IN_PROGRESS before partial capture',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            reason: 'capture',
          },
        },
        'PENDING',
        tx,
      );

      await this.stateTransitionService.transitionIntent(
        intentId,
        'PARTIALLY_CAPTURED',
        {
          correlationId,
          causationId,
          reasonCode: 'INTENT_PARTIALLY_CAPTURED',
          reasonMessage: 'Some required legs captured',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            reason: 'partial_capture',
          },
        },
        'IN_PROGRESS',
        tx,
      );
      return;
    }

    if (intent.status === 'IN_PROGRESS') {
      await this.stateTransitionService.transitionIntent(
        intentId,
        'PARTIALLY_CAPTURED',
        {
          correlationId,
          causationId,
          reasonCode: 'INTENT_PARTIALLY_CAPTURED',
          reasonMessage: 'Some required legs captured',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            reason: 'partial_capture',
          },
        },
        'IN_PROGRESS',
        tx,
      );
    }
  }

  private async createAttempt(
    tx: DbTx,
    input: {
      intentId: string;
      legId: string;
      operation: ProviderOperation;
      correlationId: string;
      triggeredById: string;
    },
  ): Promise<PaymentAttempt> {
    return this.attemptService.createAttempt(tx, input);
  }

  private async persistProviderAttemptResult(
    tx: DbTx,
    attemptId: string,
    providerResult: ProviderOperationResult,
  ): Promise<void> {
    await this.attemptService.persistProviderAttemptResult(tx, attemptId, providerResult);
  }

  private async persistProviderAttemptFailure(
    tx: DbTx,
    attemptId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    await this.attemptService.persistProviderAttemptFailure(
      tx,
      attemptId,
      errorCode,
      errorMessage,
    );
  }

  private async readLegOperationResult(
    tx: DbTx,
    intentId: string,
    legId: string,
    attemptId: string,
  ): Promise<LegOperationResult> {
    const [intent] = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    const [leg] = await tx
      .select()
      .from(paymentLegs)
      .where(and(eq(paymentLegs.id, legId), eq(paymentLegs.intentId, intentId)))
      .limit(1);
    const [attempt] = await tx
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId))
      .limit(1);

    if (!intent) {
      throw new Error(`INTENT_NOT_FOUND: ${intentId}`);
    }
    if (!leg) {
      throw new Error(`LEG_NOT_FOUND: ${legId}`);
    }
    if (!attempt) {
      throw new Error(`ATTEMPT_NOT_FOUND: ${attemptId}`);
    }

    return { intent, leg, attempt };
  }

  private buildPaymentIntentOutboxEvent(
    intent: PaymentIntentEventSource,
    eventType:
      | 'PaymentIntentSucceeded'
      | 'PaymentIntentFailed'
      | 'PaymentIntentExpired'
      | 'PaymentIntentCancelled'
      | 'PaymentIntentSuperseded'
      | 'PaymentReconcileRequired',
    status: PaymentIntentStatus,
    extraPayload: Record<string, unknown> = {},
  ): OutboxEventInput {
    return {
      eventType,
      aggregateType: 'PaymentIntent',
      aggregateId: intent.id,
      partitionKey: intent.id,
      payload: buildPaymentIntentEventPayload({
        intentId: intent.id,
        referenceType: intent.referenceType,
        referenceId: intent.referenceId,
        customerId: intent.customerId,
        status,
        payableAmount: intent.payableAmount,
        currency: intent.currency,
        occurredAt:
          typeof extraPayload.occurredAt === 'string' ? extraPayload.occurredAt : undefined,
        extra: extraPayload,
      }),
    };
  }

  private async lockIntentOrThrow(intentId: string, tx: DbTx): Promise<LockedIntent> {
    const rows = (await tx.execute(sql`
      select
        id,
        reference_type as "referenceType",
        reference_id as "referenceId",
        customer_id as "customerId",
        currency,
        payable_amount as "payableAmount",
        expires_at as "expiresAt",
        status,
        version
      from payment_intents
      where id = ${intentId}
      for update
    `)) as unknown as Array<
      Omit<LockedIntent, 'expiresAt'> & {
        expiresAt: Date | string | number | null;
      }
    >;

    const intent = rows[0];
    if (!intent) {
      throw new NotFoundException({
        error: 'INTENT_NOT_FOUND',
        message: `Payment intent not found: ${intentId}`,
      });
    }

    const expiresAt = new Date(intent.expiresAt ?? Number.NaN);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new Error(`INTENT_EXPIRES_AT_INVALID: ${intentId}`);
    }

    return {
      ...intent,
      expiresAt,
    };
  }

  private async lockLegOrThrow(
    intentId: string,
    legId: string,
    tx: DbTx,
  ): Promise<LockedLeg> {
    const rows = (await tx.execute(sql`
      select
        id,
        intent_id as "intentId",
        provider_type as "providerType",
        amount,
        status,
        version,
        metadata
      from payment_legs
      where intent_id = ${intentId}
        and id = ${legId}
      for update
    `)) as unknown as LockedLeg[];

    const leg = rows[0];
    if (!leg) {
      throw new NotFoundException({
        error: 'LEG_NOT_FOUND',
        message: `Payment leg not found: ${legId}`,
      });
    }

    return leg;
  }

  private assertIntentCanExecuteLeg(status: PaymentIntentStatus): void {
    if (
      status !== 'PENDING' &&
      status !== 'IN_PROGRESS' &&
      status !== 'PARTIALLY_CAPTURED'
    ) {
      throw new ConflictException({
        error: 'INTENT_NOT_ACTIVE',
        message: `Intent status ${status} is not checkout-active`,
      });
    }
  }

  private assertLegStatus(
    currentStatus: PaymentLegStatus,
    expectedStatus: PaymentLegStatus,
    legId: string,
    operation: string,
  ): void {
    if (currentStatus !== expectedStatus) {
      throw new ConflictException({
        error: 'LEG_STATE_INVALID',
        message: `Leg ${legId} is not ${expectedStatus} for ${operation}: current=${currentStatus}`,
      });
    }
  }
}
