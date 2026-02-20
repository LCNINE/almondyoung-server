import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  PaymentAttemptStatus,
  PaymentIntentStatus,
  PaymentLegStatus,
  PaymentReferenceType,
  WalletSchema,
  manualCancelQueueItems,
  paymentAttempts,
  paymentIntents,
  paymentLegs,
  paymentStateTransitions,
} from '../schema';
import { DbTx } from '../types';
import { ProviderRegistry } from '../providers/provider.registry';
import { ProviderOperation } from '../providers/payment-provider.types';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { buildPaymentIntentEventPayload } from '../messaging/payments-event.builder';
import {
  ManualActionQueueService,
  ManualActionType,
  OPEN_MANUAL_QUEUE_STATUSES,
} from '../intents/support/manual-action-queue.service';

const ATTEMPT_POLLABLE_STATUSES: PaymentAttemptStatus[] = [
  'UNKNOWN',
  'PENDING_PROVIDER',
  'REQUIRES_ACTION',
];

interface ReconcileStats {
  processedAttempts: number;
  transitionedAttempts: number;
  processedLegs: number;
  transitionedLegs: number;
  processedIntents: number;
  transitionedIntents: number;
  upsertedQueueItems: number;
}

interface RetryReconcileInput {
  reasonCode: string;
  reasonMessage?: string;
  actorId?: string;
  correlationId?: string;
}

interface RetryIntentResult {
  intentId: string;
  status: PaymentIntentStatus;
}

interface RetryLegResult {
  legId: string;
  status: PaymentLegStatus;
  intentId: string;
}

interface LockedAttempt {
  id: string;
  intentId: string;
  legId: string;
  status: PaymentAttemptStatus;
  requestPayload: Record<string, unknown> | null;
}

interface LockedLeg {
  id: string;
  intentId: string;
  providerType: string;
  status: PaymentLegStatus;
}

interface LockedIntent {
  id: string;
  referenceType: PaymentReferenceType;
  referenceId: string;
  userId: string;
  currency: string;
  payableAmount: number;
  status: PaymentIntentStatus;
}

@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly providerRegistry: ProviderRegistry,
    private readonly stateTransitionService: StateTransitionService,
    private readonly manualActionQueueService: ManualActionQueueService,
  ) {}

  async runBatch(
    trigger: 'SCHEDULED' | 'MANUAL' = 'SCHEDULED',
    correlationId?: string,
  ): Promise<ReconcileStats> {
    const batchCorrelationId = correlationId?.trim() || randomUUID();
    const batchSize = this.readBatchSize();
    const stats: ReconcileStats = {
      processedAttempts: 0,
      transitionedAttempts: 0,
      processedLegs: 0,
      transitionedLegs: 0,
      processedIntents: 0,
      transitionedIntents: 0,
      upsertedQueueItems: 0,
    };

    const attempts = await this.dbService.db
      .select({ id: paymentAttempts.id })
      .from(paymentAttempts)
      .where(inArray(paymentAttempts.status, ATTEMPT_POLLABLE_STATUSES))
      .orderBy(asc(paymentAttempts.createdAt))
      .limit(batchSize);

    for (const attempt of attempts) {
      const itemCorrelationId = `${batchCorrelationId}:attempt:${attempt.id}`;
      try {
        await this.reconcilePollableAttempt(attempt.id, itemCorrelationId, stats);
      } catch (error) {
        this.logger.warn(
          `Failed to reconcile pollable attempt id=${attempt.id}: ${this.stringifyError(error)}`,
        );
      }
    }

    const legs = await this.dbService.db
      .select({ id: paymentLegs.id })
      .from(paymentLegs)
      .where(inArray(paymentLegs.status, ['CANCELING', 'REFUNDING', 'RECONCILE_REQUIRED']))
      .orderBy(asc(paymentLegs.updatedAt))
      .limit(batchSize);

    for (const leg of legs) {
      const itemCorrelationId = `${batchCorrelationId}:leg:${leg.id}`;
      try {
        await this.reconcileInFlightLeg(leg.id, itemCorrelationId, stats);
      } catch (error) {
        this.logger.warn(
          `Failed to reconcile in-flight leg id=${leg.id}: ${this.stringifyError(error)}`,
        );
      }
    }

    const intents = await this.dbService.db
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(
        inArray(paymentIntents.status, [
          'RECONCILING',
          'RECONCILE_REQUIRED',
          'SUPERSEDED_RECONCILE_REQUIRED',
        ]),
      )
      .orderBy(asc(paymentIntents.updatedAt))
      .limit(batchSize);

    for (const intent of intents) {
      const itemCorrelationId = `${batchCorrelationId}:intent:${intent.id}`;
      try {
        await this.finalizeReconcileIntent(intent.id, itemCorrelationId, stats);
      } catch (error) {
        this.logger.warn(
          `Failed to finalize reconciling intent id=${intent.id}: ${this.stringifyError(error)}`,
        );
      }
    }

    this.logger.log(
      `Reconcile batch finished: trigger=${trigger}, attempts=${stats.processedAttempts}/${stats.transitionedAttempts}, legs=${stats.processedLegs}/${stats.transitionedLegs}, intents=${stats.processedIntents}/${stats.transitionedIntents}, queueUpserts=${stats.upsertedQueueItems}`,
    );

    return stats;
  }

  async retryIntent(
    intentId: string,
    input: RetryReconcileInput,
  ): Promise<RetryIntentResult> {
    const correlationId = input.correlationId?.trim() || randomUUID();
    const stats: ReconcileStats = {
      processedAttempts: 0,
      transitionedAttempts: 0,
      processedLegs: 0,
      transitionedLegs: 0,
      processedIntents: 0,
      transitionedIntents: 0,
      upsertedQueueItems: 0,
    };

    const locked = await this.dbService.db.transaction(async (tx) => {
      const intent = await this.lockIntentOrNull(intentId, tx);
      if (!intent) {
        throw new NotFoundException({
          error: 'INTENT_NOT_FOUND',
          message: `Payment intent not found: ${intentId}`,
        });
      }

      if (
        intent.status !== 'RECONCILING' &&
        intent.status !== 'RECONCILE_REQUIRED' &&
        intent.status !== 'SUPERSEDED_RECONCILE_REQUIRED'
      ) {
        throw new ConflictException({
          error: 'RECONCILE_RETRY_NOT_ALLOWED',
          message: `Intent status ${intent.status} does not allow reconcile retry`,
        });
      }

      const legs = await tx
        .select({ id: paymentLegs.id })
        .from(paymentLegs)
        .where(
          and(
            eq(paymentLegs.intentId, intentId),
            inArray(paymentLegs.status, [
              'CANCELING',
              'REFUNDING',
              'RECONCILE_REQUIRED',
            ]),
          ),
        );

      return {
        status: intent.status,
        legIds: legs.map((leg) => leg.id),
      };
    });

    for (const legId of locked.legIds) {
      await this.reconcileInFlightLeg(legId, `${correlationId}:retry-leg:${legId}`, stats);
    }

    await this.finalizeReconcileIntent(
      intentId,
      `${correlationId}:retry-intent:${intentId}`,
      stats,
      {
        reasonCode: input.reasonCode,
        reasonMessage: input.reasonMessage,
        actorId: input.actorId,
      },
    );

    const refreshedIntent = await this.dbService.db
      .select({ status: paymentIntents.status })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);

    return {
      intentId,
      status: refreshedIntent[0]?.status ?? locked.status,
    };
  }

  async retryLeg(
    legId: string,
    input: RetryReconcileInput,
  ): Promise<RetryLegResult> {
    const correlationId = input.correlationId?.trim() || randomUUID();
    const stats: ReconcileStats = {
      processedAttempts: 0,
      transitionedAttempts: 0,
      processedLegs: 0,
      transitionedLegs: 0,
      processedIntents: 0,
      transitionedIntents: 0,
      upsertedQueueItems: 0,
    };

    const lockedLeg = await this.dbService.db.transaction(async (tx) => {
      const legSnapshot = await this.readLegOrNull(legId, tx);
      if (!legSnapshot) {
        throw new NotFoundException({
          error: 'LEG_NOT_FOUND',
          message: `Payment leg not found: ${legId}`,
        });
      }

      const intent = await this.lockIntentOrNull(legSnapshot.intentId, tx);
      if (!intent) {
        throw new NotFoundException({
          error: 'INTENT_NOT_FOUND',
          message: `Payment intent not found: ${legSnapshot.intentId}`,
        });
      }

      const leg = await this.lockLegByIntentOrNull(intent.id, legId, tx);
      if (!leg) {
        throw new NotFoundException({
          error: 'LEG_NOT_FOUND',
          message: `Payment leg not found: ${legId}`,
        });
      }

      if (
        leg.status !== 'CANCELING' &&
        leg.status !== 'REFUNDING' &&
        leg.status !== 'RECONCILE_REQUIRED'
      ) {
        throw new ConflictException({
          error: 'RECONCILE_RETRY_NOT_ALLOWED',
          message: `Leg status ${leg.status} does not allow reconcile retry`,
        });
      }

      return leg;
    });

    await this.reconcileInFlightLeg(legId, `${correlationId}:retry-leg:${legId}`, stats);
    await this.finalizeReconcileIntent(
      lockedLeg.intentId,
      `${correlationId}:retry-intent:${lockedLeg.intentId}`,
      stats,
      {
        reasonCode: input.reasonCode,
        reasonMessage: input.reasonMessage,
        actorId: input.actorId,
      },
    );

    const refreshedLeg = await this.dbService.db
      .select({ status: paymentLegs.status })
      .from(paymentLegs)
      .where(eq(paymentLegs.id, legId))
      .limit(1);

    return {
      legId,
      status: refreshedLeg[0]?.status ?? lockedLeg.status,
      intentId: lockedLeg.intentId,
    };
  }

  private async reconcilePollableAttempt(
    attemptId: string,
    correlationId: string,
    stats: ReconcileStats,
  ): Promise<void> {
    const prepared = await this.dbService.db.transaction(async (tx) => {
      const attemptSnapshot = await this.readAttemptOrNull(attemptId, tx);
      if (!attemptSnapshot || !ATTEMPT_POLLABLE_STATUSES.includes(attemptSnapshot.status)) {
        return null;
      }

      const intent = await this.lockIntentOrNull(attemptSnapshot.intentId, tx);
      if (!intent) {
        return null;
      }

      const leg = await this.lockLegByIntentOrNull(intent.id, attemptSnapshot.legId, tx);
      if (!leg) {
        return null;
      }

      const attempt = await this.lockAttemptOrNull(attemptId, tx);
      if (
        !attempt ||
        attempt.intentId !== intent.id ||
        attempt.legId !== leg.id ||
        !ATTEMPT_POLLABLE_STATUSES.includes(attempt.status)
      ) {
        return null;
      }

      return {
        attemptId: attempt.id,
        intentId: intent.id,
        legId: leg.id,
        providerType: leg.providerType,
      };
    });

    if (!prepared) {
      return;
    }
    stats.processedAttempts += 1;

    const provider = this.providerRegistry.assertPollStatusCapability(
      prepared.providerType,
      {
        intentId: prepared.intentId,
        legId: prepared.legId,
      },
    );
    const providerSnapshot = await provider.getTransaction({
      intentId: prepared.intentId,
      legId: prepared.legId,
      correlationId,
    });

    await this.dbService.db.transaction(async (tx) => {
      const attemptSnapshot = await this.readAttemptOrNull(prepared.attemptId, tx);
      if (!attemptSnapshot) {
        return;
      }

      const intent = await this.lockIntentOrNull(attemptSnapshot.intentId, tx);
      if (!intent) {
        return;
      }

      const leg = await this.lockLegByIntentOrNull(
        intent.id,
        attemptSnapshot.legId,
        tx,
      );
      if (!leg) {
        return;
      }

      const attempt = await this.lockAttemptOrNull(prepared.attemptId, tx);
      if (
        !attempt ||
        attempt.intentId !== intent.id ||
        attempt.legId !== leg.id ||
        !ATTEMPT_POLLABLE_STATUSES.includes(attempt.status)
      ) {
        return;
      }

      const operation = this.resolveAttemptOperation(attempt.requestPayload);
      const resolvedAttemptStatus = this.mapSnapshotToAttemptStatus(
        operation,
        providerSnapshot.status,
      );

      if (!resolvedAttemptStatus) {
        const unresolvedStatusTarget =
          attempt.status === 'UNKNOWN' ? 'RECONCILE_REQUIRED' : 'UNKNOWN';

        await this.stateTransitionService.transitionAttempt(
          attempt.id,
          unresolvedStatusTarget,
          {
            correlationId,
            causationId: leg.id,
            reasonCode: 'ATTEMPT_RECONCILE_UNRESOLVED',
            reasonMessage: `Provider status did not resolve ${attempt.status} attempt: ${providerSnapshot.status}`,
            triggeredByType: 'SYSTEM',
            triggeredById: 'system',
            payload: {
              providerStatus: providerSnapshot.status,
              operation,
              previousAttemptStatus: attempt.status,
            },
          },
          attempt.status,
          tx,
        );
        stats.transitionedAttempts += 1;

        if (leg.status === 'CANCELING' || leg.status === 'REFUNDING') {
          await this.stateTransitionService.transitionLeg(
            leg.id,
            'RECONCILE_REQUIRED',
            {
              correlationId,
              reasonCode: 'LEG_RECONCILE_UNRESOLVED',
              reasonMessage: `Leg reconcile unresolved: providerStatus=${providerSnapshot.status}`,
              triggeredByType: 'SYSTEM',
              triggeredById: 'system',
              payload: {
                providerStatus: providerSnapshot.status,
              },
            },
            leg.status,
            tx,
          );
          stats.transitionedLegs += 1;

          await this.upsertManualQueueItem(
            tx,
            {
              intentId: leg.intentId,
              legId: leg.id,
              actionType: leg.status === 'CANCELING' ? 'CANCEL' : 'REFUND',
              reasonCode: 'RECONCILE_UNRESOLVED',
              reasonMessage: `Reconcile unresolved for leg status ${leg.status}`,
            },
            correlationId,
          );
          stats.upsertedQueueItems += 1;
        }
        return;
      }

      await this.stateTransitionService.transitionAttempt(
        attempt.id,
        resolvedAttemptStatus,
        {
          correlationId,
          causationId: leg.id,
          reasonCode: 'ATTEMPT_RECONCILE_RESOLVED',
          reasonMessage: `${attempt.status} attempt resolved by provider polling: ${resolvedAttemptStatus}`,
          triggeredByType: 'SYSTEM',
          triggeredById: 'system',
          payload: {
            providerStatus: providerSnapshot.status,
            operation,
            previousAttemptStatus: attempt.status,
          },
        },
        attempt.status,
        tx,
      );
      stats.transitionedAttempts += 1;

      if (leg.status === 'CANCELING') {
        if (resolvedAttemptStatus === 'CANCELLED') {
          await this.stateTransitionService.transitionLeg(
            leg.id,
            'CANCELLED',
            {
              correlationId,
              reasonCode: 'LEG_RECONCILE_CANCELLED',
              reasonMessage: 'Leg cancellation resolved by provider polling',
              triggeredByType: 'SYSTEM',
              triggeredById: 'system',
            },
            'CANCELING',
            tx,
          );
          stats.transitionedLegs += 1;
        } else if (resolvedAttemptStatus === 'REFUNDED') {
          await this.stateTransitionService.transitionLeg(
            leg.id,
            'REFUNDED',
            {
              correlationId,
              reasonCode: 'LEG_RECONCILE_REFUNDED',
              reasonMessage: 'Leg refund resolved by provider polling',
              triggeredByType: 'SYSTEM',
              triggeredById: 'system',
            },
            'CANCELING',
            tx,
          );
          stats.transitionedLegs += 1;
        }
      } else if (leg.status === 'REFUNDING' && resolvedAttemptStatus === 'REFUNDED') {
        await this.stateTransitionService.transitionLeg(
          leg.id,
          'REFUNDED',
          {
            correlationId,
            reasonCode: 'LEG_RECONCILE_REFUNDED',
            reasonMessage: 'Leg refund resolved by provider polling',
            triggeredByType: 'SYSTEM',
            triggeredById: 'system',
          },
          'REFUNDING',
          tx,
        );
        stats.transitionedLegs += 1;
      } else if (leg.status === 'RECONCILE_REQUIRED') {
        if (resolvedAttemptStatus === 'CANCELLED' || resolvedAttemptStatus === 'REFUNDED') {
          await this.stateTransitionService.transitionLeg(
            leg.id,
            resolvedAttemptStatus,
            {
              correlationId,
              reasonCode: 'LEG_RECONCILE_RESOLVED',
              reasonMessage: `Leg reconcile resolved to ${resolvedAttemptStatus}`,
              triggeredByType: 'SYSTEM',
              triggeredById: 'system',
            },
            'RECONCILE_REQUIRED',
            tx,
          );
          stats.transitionedLegs += 1;
        }
      }
    });
  }

  private async reconcileInFlightLeg(
    legId: string,
    correlationId: string,
    stats: ReconcileStats,
  ): Promise<void> {
    const prepared = await this.dbService.db.transaction(async (tx) => {
      const legSnapshot = await this.readLegOrNull(legId, tx);
      if (!legSnapshot || !this.isReconcileTargetLegStatus(legSnapshot.status)) {
        return null;
      }

      const intent = await this.lockIntentOrNull(legSnapshot.intentId, tx);
      if (!intent) {
        return null;
      }

      const leg = await this.lockLegByIntentOrNull(intent.id, legId, tx);
      if (!leg || !this.isReconcileTargetLegStatus(leg.status)) {
        return null;
      }

      return {
        intentId: intent.id,
        legId: leg.id,
        providerType: leg.providerType,
      };
    });

    if (!prepared) {
      return;
    }
    stats.processedLegs += 1;

    const provider = this.providerRegistry.assertPollStatusCapability(
      prepared.providerType,
      {
        intentId: prepared.intentId,
        legId: prepared.legId,
      },
    );
    const providerSnapshot = await provider.getTransaction({
      intentId: prepared.intentId,
      legId: prepared.legId,
      correlationId,
    });
    const normalizedStatus = providerSnapshot.status.trim().toUpperCase();

    await this.dbService.db.transaction(async (tx) => {
      const legSnapshot = await this.readLegOrNull(prepared.legId, tx);
      if (!legSnapshot || !this.isReconcileTargetLegStatus(legSnapshot.status)) {
        return;
      }

      const intent = await this.lockIntentOrNull(legSnapshot.intentId, tx);
      if (!intent) {
        return;
      }

      const leg = await this.lockLegByIntentOrNull(intent.id, prepared.legId, tx);
      if (!leg || !this.isReconcileTargetLegStatus(leg.status)) {
        return;
      }

      if (normalizedStatus === 'CANCELLED') {
        await this.stateTransitionService.transitionLeg(
          leg.id,
          'CANCELLED',
          {
            correlationId,
            reasonCode: 'LEG_RECONCILE_CANCELLED',
            reasonMessage: 'Leg cancellation resolved by provider polling',
            triggeredByType: 'SYSTEM',
            triggeredById: 'system',
          },
          leg.status,
          tx,
        );
        stats.transitionedLegs += 1;
        return;
      }

      if (normalizedStatus === 'REFUNDED') {
        await this.stateTransitionService.transitionLeg(
          leg.id,
          'REFUNDED',
          {
            correlationId,
            reasonCode: 'LEG_RECONCILE_REFUNDED',
            reasonMessage: 'Leg refund resolved by provider polling',
            triggeredByType: 'SYSTEM',
            triggeredById: 'system',
          },
          leg.status,
          tx,
        );
        stats.transitionedLegs += 1;
        return;
      }

      if (leg.status !== 'RECONCILE_REQUIRED') {
        await this.stateTransitionService.transitionLeg(
          leg.id,
          'RECONCILE_REQUIRED',
          {
            correlationId,
            reasonCode: 'LEG_RECONCILE_REQUIRED',
            reasonMessage: `Provider polling unresolved for ${leg.status}: ${providerSnapshot.status}`,
            triggeredByType: 'SYSTEM',
            triggeredById: 'system',
            payload: {
              providerStatus: providerSnapshot.status,
            },
          },
          leg.status,
          tx,
        );
        stats.transitionedLegs += 1;
      }

      const actionType = await this.resolveManualActionTypeForLeg(tx, leg);

      await this.upsertManualQueueItem(
        tx,
        {
          intentId: leg.intentId,
          legId: leg.id,
          actionType,
          reasonCode: 'RECONCILE_REQUIRED',
          reasonMessage: `Provider polling unresolved for ${leg.status}: ${providerSnapshot.status}`,
        },
        correlationId,
      );
      stats.upsertedQueueItems += 1;
    });
  }

  private async finalizeReconcileIntent(
    intentId: string,
    correlationId: string,
    stats: ReconcileStats,
    retryContext?: {
      reasonCode?: string;
      reasonMessage?: string;
      actorId?: string;
    },
  ): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      const intent = await this.lockIntentOrNull(intentId, tx);
      if (
        !intent ||
        (intent.status !== 'RECONCILING' &&
          intent.status !== 'RECONCILE_REQUIRED' &&
          intent.status !== 'SUPERSEDED_RECONCILE_REQUIRED')
      ) {
        return;
      }
      stats.processedIntents += 1;

      const legRows = await tx
        .select({
          status: paymentLegs.status,
        })
        .from(paymentLegs)
        .where(eq(paymentLegs.intentId, intentId));

      if (legRows.some((row) => row.status === 'CANCELING' || row.status === 'REFUNDING')) {
        return;
      }

      const hasReconcileRequiredLeg = legRows.some(
        (row) => row.status === 'RECONCILE_REQUIRED',
      );

      if (hasReconcileRequiredLeg) {
        if (intent.status === 'RECONCILING') {
          const manualQueueItemIds = await this.readOpenManualQueueItemIds(
            tx,
            intent.id,
          );

          await this.stateTransitionService.transitionIntent(
            intent.id,
            'RECONCILE_REQUIRED',
            {
              correlationId,
              reasonCode: retryContext?.reasonCode ?? 'INTENT_RECONCILE_REQUIRED',
              reasonMessage:
                retryContext?.reasonMessage ?? 'Compensation was not fully resolved',
              triggeredByType: 'SYSTEM',
              triggeredById: retryContext?.actorId ?? 'system',
              payload: {
                manualQueueItemId: manualQueueItemIds[0] ?? null,
                manualQueueItemIds,
              },
              outboxEvent: {
                eventType: 'PaymentReconcileRequired',
                aggregateType: 'PaymentIntent',
                aggregateId: intent.id,
                partitionKey: intent.id,
                payload: buildPaymentIntentEventPayload({
                  intentId: intent.id,
                  referenceType: intent.referenceType,
                  referenceId: intent.referenceId,
                  userId: intent.userId,
                  status: 'RECONCILE_REQUIRED',
                  payableAmount: intent.payableAmount,
                  currency: intent.currency,
                  extra: {
                    reasonCode: retryContext?.reasonCode ?? 'INTENT_RECONCILE_REQUIRED',
                    reasonMessage:
                      retryContext?.reasonMessage ??
                      'Compensation was not fully resolved',
                    requiresManualAction: true,
                    manualQueueItemId: manualQueueItemIds[0] ?? null,
                    manualQueueItemIds,
                  },
                }),
              },
            },
            'RECONCILING',
            tx,
          );
          stats.transitionedIntents += 1;
        }
        return;
      }

      if (intent.status === 'SUPERSEDED_RECONCILE_REQUIRED') {
        await this.stateTransitionService.transitionIntent(
          intent.id,
          'SUPERSEDED',
          {
            correlationId,
            reasonCode: retryContext?.reasonCode ?? 'INTENT_SUPERSEDE_RECONCILE_RESOLVED',
            reasonMessage:
              retryContext?.reasonMessage ??
              'Supersede reconcile resolved and finalized',
            triggeredByType: 'SYSTEM',
            triggeredById: retryContext?.actorId ?? 'system',
            outboxEvent: {
              eventType: 'PaymentIntentSuperseded',
              aggregateType: 'PaymentIntent',
              aggregateId: intent.id,
              partitionKey: intent.id,
              payload: buildPaymentIntentEventPayload({
                intentId: intent.id,
                referenceType: intent.referenceType,
                referenceId: intent.referenceId,
                userId: intent.userId,
                status: 'SUPERSEDED',
                payableAmount: intent.payableAmount,
                currency: intent.currency,
              }),
            },
          },
          'SUPERSEDED_RECONCILE_REQUIRED',
          tx,
        );
        stats.transitionedIntents += 1;
        return;
      }

      const finalStatus = await this.resolveFinalIntentStatusFromReconcileContext(
        tx,
        intent.id,
      );
      const eventType =
        finalStatus === 'CANCELLED'
          ? 'PaymentIntentCancelled'
          : finalStatus === 'EXPIRED'
            ? 'PaymentIntentExpired'
            : 'PaymentIntentFailed';

      await this.stateTransitionService.transitionIntent(
        intent.id,
        finalStatus,
        {
          correlationId,
          reasonCode: retryContext?.reasonCode ?? 'INTENT_RECONCILE_COMPLETED',
          reasonMessage:
            retryContext?.reasonMessage ?? `Reconcile completed: ${finalStatus}`,
          triggeredByType: 'SYSTEM',
          triggeredById: retryContext?.actorId ?? 'system',
          outboxEvent: {
            eventType,
            aggregateType: 'PaymentIntent',
            aggregateId: intent.id,
            partitionKey: intent.id,
            payload: buildPaymentIntentEventPayload({
              intentId: intent.id,
              referenceType: intent.referenceType,
              referenceId: intent.referenceId,
              userId: intent.userId,
              status: finalStatus,
              payableAmount: intent.payableAmount,
              currency: intent.currency,
            }),
          },
        },
        intent.status,
        tx,
      );
      stats.transitionedIntents += 1;
    });
  }

  private async upsertManualQueueItem(
    tx: DbTx,
    input: {
      intentId: string;
      legId: string;
      actionType: ManualActionType;
      reasonCode: string;
      reasonMessage: string;
    },
    correlationId: string,
  ): Promise<void> {
    await this.manualActionQueueService.upsertManualQueueItem(tx, {
      ...input,
      correlationId,
      triggeredById: 'system',
      creationReasonMessage: 'Manual queue item created by reconcile',
    });
  }

  private async resolveManualActionTypeForLeg(
    tx: DbTx,
    leg: LockedLeg,
  ): Promise<ManualActionType> {
    if (leg.status === 'CANCELING') {
      return 'CANCEL';
    }
    if (leg.status === 'REFUNDING') {
      return 'REFUND';
    }

    const latestAttempts = await tx
      .select({
        requestPayload: paymentAttempts.requestPayload,
      })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.legId, leg.id))
      .orderBy(desc(paymentAttempts.createdAt))
      .limit(1);

    const latestOperation = this.resolveAttemptOperation(
      latestAttempts[0]?.requestPayload ?? null,
    );

    if (latestOperation === 'CANCEL') {
      return 'CANCEL';
    }
    if (latestOperation === 'MANUAL_CONFIRM') {
      return 'MANUAL_CONFIRM';
    }

    return 'REFUND';
  }

  private async resolveFinalIntentStatusFromReconcileContext(
    tx: DbTx,
    intentId: string,
  ): Promise<'FAILED' | 'EXPIRED' | 'CANCELLED'> {
    const rows = await tx
      .select({
        reasonCode: paymentStateTransitions.reasonCode,
      })
      .from(paymentStateTransitions)
      .where(
        and(
          eq(paymentStateTransitions.entityType, 'INTENT'),
          eq(paymentStateTransitions.entityId, intentId),
          eq(paymentStateTransitions.newStatus, 'RECONCILING'),
        ),
      )
      .orderBy(asc(paymentStateTransitions.occurredAt));

    const latestReasonCode = rows[rows.length - 1]?.reasonCode ?? null;
    if (latestReasonCode === 'INTENT_CANCEL_RECONCILING') {
      return 'CANCELLED';
    }
    if (latestReasonCode === 'INTENT_EXPIRE_RECONCILING') {
      return 'EXPIRED';
    }
    return 'FAILED';
  }

  private async readOpenManualQueueItemIds(
    tx: DbTx,
    intentId: string,
  ): Promise<string[]> {
    const rows = await tx
      .select({
        id: manualCancelQueueItems.id,
      })
      .from(manualCancelQueueItems)
      .where(
        and(
          eq(manualCancelQueueItems.intentId, intentId),
          inArray(manualCancelQueueItems.status, OPEN_MANUAL_QUEUE_STATUSES),
        ),
      )
      .orderBy(asc(manualCancelQueueItems.createdAt));

    return rows.map((row) => row.id);
  }

  private resolveAttemptOperation(
    requestPayload: Record<string, unknown> | null,
  ): ProviderOperation | null {
    const operation = requestPayload?.operation;
    if (
      operation === 'AUTHORIZE' ||
      operation === 'CAPTURE' ||
      operation === 'CANCEL' ||
      operation === 'REFUND' ||
      operation === 'MANUAL_CONFIRM'
    ) {
      return operation;
    }

    return null;
  }

  private mapSnapshotToAttemptStatus(
    operation: ProviderOperation | null,
    providerStatus: string,
  ): PaymentAttemptStatus | null {
    const normalizedStatus = providerStatus.trim().toUpperCase();

    if (operation === 'CANCEL') {
      if (normalizedStatus === 'CANCELLED') {
        return 'CANCELLED';
      }
      if (normalizedStatus === 'REFUNDED') {
        return 'REFUNDED';
      }
      return null;
    }

    if (operation === 'REFUND') {
      return normalizedStatus === 'REFUNDED' ? 'REFUNDED' : null;
    }

    if (operation === 'CAPTURE') {
      return normalizedStatus === 'CAPTURED' ? 'CAPTURED' : null;
    }

    if (operation === 'AUTHORIZE') {
      if (normalizedStatus === 'AUTHORIZED') {
        return 'AUTHORIZED';
      }
      if (normalizedStatus === 'CAPTURED') {
        return 'CAPTURED';
      }
      return null;
    }

    if (normalizedStatus === 'CANCELLED') {
      return 'CANCELLED';
    }
    if (normalizedStatus === 'REFUNDED') {
      return 'REFUNDED';
    }
    if (normalizedStatus === 'CAPTURED') {
      return 'CAPTURED';
    }
    if (normalizedStatus === 'AUTHORIZED') {
      return 'AUTHORIZED';
    }

    return null;
  }

  private isReconcileTargetLegStatus(status: PaymentLegStatus): boolean {
    return (
      status === 'CANCELING' || status === 'REFUNDING' || status === 'RECONCILE_REQUIRED'
    );
  }

  private async readAttemptOrNull(attemptId: string, tx: DbTx): Promise<LockedAttempt | null> {
    const rows = (await tx.execute(sql`
      select
        id,
        intent_id as "intentId",
        leg_id as "legId",
        status,
        request_payload as "requestPayload"
      from payment_attempts
      where id = ${attemptId}
      limit 1
    `)) as unknown as LockedAttempt[];

    return rows[0] ?? null;
  }

  private readBatchSize(): number {
    const parsed = Number(process.env.WALLET_RECONCILE_BATCH_SIZE ?? 50);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 50;
    }
    return Math.floor(parsed);
  }

  private async lockAttemptOrNull(attemptId: string, tx: DbTx): Promise<LockedAttempt | null> {
    const rows = (await tx.execute(sql`
      select
        id,
        intent_id as "intentId",
        leg_id as "legId",
        status,
        request_payload as "requestPayload"
      from payment_attempts
      where id = ${attemptId}
      for update
    `)) as unknown as LockedAttempt[];

    return rows[0] ?? null;
  }

  private async readLegOrNull(legId: string, tx: DbTx): Promise<LockedLeg | null> {
    const rows = (await tx.execute(sql`
      select
        id,
        intent_id as "intentId",
        provider_type as "providerType",
        status
      from payment_legs
      where id = ${legId}
      limit 1
    `)) as unknown as LockedLeg[];

    return rows[0] ?? null;
  }

  private async lockLegByIntentOrNull(
    intentId: string,
    legId: string,
    tx: DbTx,
  ): Promise<LockedLeg | null> {
    const rows = (await tx.execute(sql`
      select
        id,
        intent_id as "intentId",
        provider_type as "providerType",
        status
      from payment_legs
      where id = ${legId}
        and intent_id = ${intentId}
      for update
    `)) as unknown as LockedLeg[];

    return rows[0] ?? null;
  }

  private async lockIntentOrNull(intentId: string, tx: DbTx): Promise<LockedIntent | null> {
    const rows = (await tx.execute(sql`
      select
        id,
        reference_type as "referenceType",
        reference_id as "referenceId",
        user_id as "userId",
        currency,
        payable_amount as "payableAmount",
        status
      from payment_intents
      where id = ${intentId}
      for update
    `)) as unknown as LockedIntent[];

    return rows[0] ?? null;
  }

  private stringifyError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
