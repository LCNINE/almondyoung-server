import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  PaymentIntentStatus,
  PaymentLegStatus,
  PaymentReferenceType,
  WalletSchema,
  paymentIntents,
  paymentLegs,
} from '../../schema';
import { DbTx, PaymentAttempt, PaymentLeg } from '../../types';
import { ProviderRegistry } from '../../providers/provider.registry';
import {
  ProviderOperation,
  ProviderOperationResult,
} from '../../providers/payment-provider.types';
import { StateTransitionService } from '../../domain/state-transition/state-transition.service';
import { buildPaymentIntentEventPayload } from '../../messaging/payments-event.builder';
import { AttemptService } from '../support/attempt.service';
import {
  ManualActionQueueService,
  ManualActionType,
} from '../support/manual-action-queue.service';
import {
  ExpireIntentsBatchResult,
  IntentTerminationResult,
} from './intents.service.types';

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

interface CompensationExecutionResult {
  hasFailure: boolean;
  manualQueueItemIds: string[];
}

interface CompensationLegResult {
  failed: boolean;
  manualQueueItemId?: string;
}

interface PreparedCompensationOperation {
  attemptId: string;
  providerIdempotencyKey: string;
  legId: string;
  providerType: string;
  amount: number;
  metadata: Record<string, unknown>;
  operation: 'CANCEL' | 'REFUND';
  requestedStatus: 'CANCEL_REQUESTED' | 'REFUND_REQUESTED';
}

interface CompensationPrepareResult extends CompensationExecutionResult {
  operations: PreparedCompensationOperation[];
}

type TerminationReason = 'CANCEL' | 'SUPERSEDE' | 'EXPIRE';

@Injectable()
export class IntentTerminationService {
  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly providerRegistry: ProviderRegistry,
    private readonly stateTransitionService: StateTransitionService,
    private readonly attemptService: AttemptService,
    private readonly manualActionQueueService: ManualActionQueueService,
  ) {}

  async cancelIntent(
    intentId: string,
    correlationId?: string,
  ): Promise<IntentTerminationResult> {
    const requestCorrelationId = correlationId?.trim() || randomUUID();

    const prepared = await this.dbService.db.transaction(async (tx) => {
      const intent = await this.lockIntentOrThrow(intentId, tx);
      this.assertIntentCanCancel(intent.status);

      if (intent.status === 'PENDING') {
        await this.stateTransitionService.transitionIntent(
          intentId,
          'CANCELLED',
          {
            correlationId: requestCorrelationId,
            reasonCode: 'INTENT_CANCELLED',
            reasonMessage: 'Intent cancelled before payment processing',
            triggeredByType: 'USER',
            triggeredById: intent.customerId,
            payload: {
              operation: 'CANCEL',
            },
            outboxEvent: this.buildPaymentIntentOutboxEvent(
              intent,
              'PaymentIntentCancelled',
              'CANCELLED',
              {
                reasonCode: 'INTENT_CANCELLED',
                reasonMessage: 'Intent cancelled before payment processing',
              },
            ),
          },
          'PENDING',
          tx,
        );

        return {
          mode: 'DONE' as const,
          intent,
          status: 'CANCELLED' as PaymentIntentStatus,
        };
      }

      await this.stateTransitionService.transitionIntent(
        intentId,
        'RECONCILING',
        {
          correlationId: requestCorrelationId,
          reasonCode: 'INTENT_CANCEL_RECONCILING',
          reasonMessage: 'Intent cancel started with compensation',
          triggeredByType: 'USER',
          triggeredById: intent.customerId,
          payload: {
            operation: 'CANCEL',
          },
        },
        intent.status,
        tx,
      );

      const compensationPreparation = await this.prepareCompensationIntentLegs(
        tx,
        intent,
        requestCorrelationId,
        'CANCEL',
      );

      return {
        mode: 'COMPENSATE' as const,
        intent,
        compensationPreparation,
      };
    });

    if (prepared.mode === 'DONE') {
      return {
        intentId,
        status: prepared.status,
      };
    }

    const compensationExecution = await this.executeCompensationOperations(
      prepared.intent,
      prepared.compensationPreparation.operations,
      requestCorrelationId,
      'CANCEL',
    );
    const manualQueueItemIds = [
      ...new Set([
        ...prepared.compensationPreparation.manualQueueItemIds,
        ...compensationExecution.manualQueueItemIds,
      ]),
    ];
    const compensationFailed =
      prepared.compensationPreparation.hasFailure || compensationExecution.hasFailure;
    const finalStatus: PaymentIntentStatus = compensationFailed
      ? 'RECONCILE_REQUIRED'
      : 'CANCELLED';

    await this.dbService.db.transaction(async (tx) => {
      await this.stateTransitionService.transitionIntent(
        intentId,
        finalStatus,
        {
          correlationId: requestCorrelationId,
          reasonCode: compensationFailed
            ? 'INTENT_CANCEL_RECONCILE_REQUIRED'
            : 'INTENT_CANCELLED',
          reasonMessage: compensationFailed
            ? 'Intent cancellation requires manual reconcile'
            : 'Intent cancellation completed',
          triggeredByType: 'SYSTEM',
          triggeredById: prepared.intent.customerId,
          payload: {
            operation: 'CANCEL',
            compensationFailed,
            manualQueueItemId: manualQueueItemIds[0] ?? null,
            manualQueueItemIds,
          },
          outboxEvent: compensationFailed
            ? this.buildPaymentIntentOutboxEvent(
                prepared.intent,
                'PaymentReconcileRequired',
                finalStatus,
                {
                  reasonCode: 'INTENT_CANCEL_RECONCILE_REQUIRED',
                  reasonMessage: 'Intent cancellation requires manual reconcile',
                  requiresManualAction: true,
                  manualQueueItemId: manualQueueItemIds[0] ?? null,
                  manualQueueItemIds,
                },
              )
            : this.buildPaymentIntentOutboxEvent(
                prepared.intent,
                'PaymentIntentCancelled',
                finalStatus,
                {
                  reasonCode: 'INTENT_CANCELLED',
                  reasonMessage: 'Intent cancellation completed',
                },
              ),
        },
        'RECONCILING',
        tx,
      );
    });

    return {
      intentId,
      status: finalStatus,
    };
  }

  async supersedeIntent(
    intentId: string,
    correlationId?: string,
  ): Promise<IntentTerminationResult> {
    const requestCorrelationId = correlationId?.trim() || randomUUID();

    const prepared = await this.dbService.db.transaction(async (tx) => {
      const intent = await this.lockIntentOrThrow(intentId, tx);
      this.assertIntentCanSupersede(intent.status);

      await this.stateTransitionService.transitionIntent(
        intentId,
        'SUSPENDED',
        {
          correlationId: requestCorrelationId,
          reasonCode: 'INTENT_SUPERSEDE_STARTED',
          reasonMessage: 'Intent supersede started',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            operation: 'SUPERSEDE',
          },
        },
        intent.status,
        tx,
      );

      const compensationPreparation = await this.prepareCompensationIntentLegs(
        tx,
        intent,
        requestCorrelationId,
        'SUPERSEDE',
      );

      return {
        intent,
        compensationPreparation,
      };
    });

    const compensationExecution = await this.executeCompensationOperations(
      prepared.intent,
      prepared.compensationPreparation.operations,
      requestCorrelationId,
      'SUPERSEDE',
    );
    const manualQueueItemIds = [
      ...new Set([
        ...prepared.compensationPreparation.manualQueueItemIds,
        ...compensationExecution.manualQueueItemIds,
      ]),
    ];
    const compensationFailed =
      prepared.compensationPreparation.hasFailure || compensationExecution.hasFailure;
    const finalStatus: PaymentIntentStatus = compensationFailed
      ? 'SUPERSEDED_RECONCILE_REQUIRED'
      : 'SUPERSEDED';

    await this.dbService.db.transaction(async (tx) => {
      await this.stateTransitionService.transitionIntent(
        intentId,
        finalStatus,
        {
          correlationId: requestCorrelationId,
          reasonCode: compensationFailed
            ? 'INTENT_SUPERSEDE_RECONCILE_REQUIRED'
            : 'INTENT_SUPERSEDED',
          reasonMessage: compensationFailed
            ? 'Supersede compensation requires manual reconcile'
            : 'Supersede completed',
          triggeredByType: 'SYSTEM',
          triggeredById: prepared.intent.customerId,
          payload: {
            operation: 'SUPERSEDE',
            compensationFailed,
            manualQueueItemId: manualQueueItemIds[0] ?? null,
            manualQueueItemIds,
          },
          outboxEvent: compensationFailed
            ? this.buildPaymentIntentOutboxEvent(
                prepared.intent,
                'PaymentReconcileRequired',
                finalStatus,
                {
                  reasonCode: 'INTENT_SUPERSEDE_RECONCILE_REQUIRED',
                  reasonMessage: 'Supersede compensation requires manual reconcile',
                  requiresManualAction: true,
                  manualQueueItemId: manualQueueItemIds[0] ?? null,
                  manualQueueItemIds,
                },
              )
            : this.buildPaymentIntentOutboxEvent(
                prepared.intent,
                'PaymentIntentSuperseded',
                finalStatus,
                {
                  reasonCode: 'INTENT_SUPERSEDED',
                  reasonMessage: 'Supersede completed',
                },
              ),
        },
        'SUSPENDED',
        tx,
      );
    });

    return {
      intentId,
      status: finalStatus,
    };
  }

  async expireIntent(
    intentId: string,
    correlationId?: string,
  ): Promise<IntentTerminationResult> {
    const requestCorrelationId = correlationId?.trim() || randomUUID();

    const prepared = await this.dbService.db.transaction(async (tx) => {
      const intent = await this.lockIntentOrThrow(intentId, tx);
      this.assertIntentCanExpire(intent.status);

      const expiresAtMs = intent.expiresAt.getTime();
      if (Number.isNaN(expiresAtMs)) {
        throw new Error(`INTENT_EXPIRES_AT_INVALID: ${intentId}`);
      }

      if (expiresAtMs > Date.now()) {
        throw new ConflictException({
          error: 'INTENT_NOT_EXPIRED',
          message: `Intent ${intentId} is not expired yet`,
        });
      }

      if (intent.status === 'PENDING') {
        await this.stateTransitionService.transitionIntent(
          intentId,
          'EXPIRED',
          {
            correlationId: requestCorrelationId,
            reasonCode: 'INTENT_EXPIRED',
            reasonMessage: 'Intent expired before payment processing',
            triggeredByType: 'SYSTEM',
            triggeredById: 'system',
            payload: {
              operation: 'EXPIRE',
            },
            outboxEvent: this.buildPaymentIntentOutboxEvent(
              intent,
              'PaymentIntentExpired',
              'EXPIRED',
              {
                reasonCode: 'INTENT_EXPIRED',
                reasonMessage: 'Intent expired before payment processing',
              },
            ),
          },
          'PENDING',
          tx,
        );

        return {
          mode: 'DONE' as const,
          intent,
          status: 'EXPIRED' as PaymentIntentStatus,
        };
      }

      await this.stateTransitionService.transitionIntent(
        intentId,
        'RECONCILING',
        {
          correlationId: requestCorrelationId,
          reasonCode: 'INTENT_EXPIRE_RECONCILING',
          reasonMessage: 'Intent expiration started with compensation',
          triggeredByType: 'SYSTEM',
          triggeredById: 'system',
          payload: {
            operation: 'EXPIRE',
          },
        },
        intent.status,
        tx,
      );

      const compensationPreparation = await this.prepareCompensationIntentLegs(
        tx,
        intent,
        requestCorrelationId,
        'EXPIRE',
      );

      return {
        mode: 'COMPENSATE' as const,
        intent,
        compensationPreparation,
      };
    });

    if (prepared.mode === 'DONE') {
      return {
        intentId,
        status: prepared.status,
      };
    }

    const compensationExecution = await this.executeCompensationOperations(
      prepared.intent,
      prepared.compensationPreparation.operations,
      requestCorrelationId,
      'EXPIRE',
    );
    const manualQueueItemIds = [
      ...new Set([
        ...prepared.compensationPreparation.manualQueueItemIds,
        ...compensationExecution.manualQueueItemIds,
      ]),
    ];
    const compensationFailed =
      prepared.compensationPreparation.hasFailure || compensationExecution.hasFailure;
    const finalStatus: PaymentIntentStatus = compensationFailed
      ? 'RECONCILE_REQUIRED'
      : 'EXPIRED';

    await this.dbService.db.transaction(async (tx) => {
      await this.stateTransitionService.transitionIntent(
        intentId,
        finalStatus,
        {
          correlationId: requestCorrelationId,
          reasonCode: compensationFailed
            ? 'INTENT_EXPIRE_RECONCILE_REQUIRED'
            : 'INTENT_EXPIRED',
          reasonMessage: compensationFailed
            ? 'Intent expiration requires manual reconcile'
            : 'Intent expiration completed',
          triggeredByType: 'SYSTEM',
          triggeredById: 'system',
          payload: {
            operation: 'EXPIRE',
            compensationFailed,
            manualQueueItemId: manualQueueItemIds[0] ?? null,
            manualQueueItemIds,
          },
          outboxEvent: compensationFailed
            ? this.buildPaymentIntentOutboxEvent(
                prepared.intent,
                'PaymentReconcileRequired',
                finalStatus,
                {
                  reasonCode: 'INTENT_EXPIRE_RECONCILE_REQUIRED',
                  reasonMessage: 'Intent expiration requires manual reconcile',
                  requiresManualAction: true,
                  manualQueueItemId: manualQueueItemIds[0] ?? null,
                  manualQueueItemIds,
                },
              )
            : this.buildPaymentIntentOutboxEvent(
                prepared.intent,
                'PaymentIntentExpired',
                finalStatus,
                {
                  reasonCode: 'INTENT_EXPIRED',
                  reasonMessage: 'Intent expiration completed',
                },
              ),
        },
        'RECONCILING',
        tx,
      );
    });

    return {
      intentId,
      status: finalStatus,
    };
  }

  async expireDueIntents(
    limit?: number,
    correlationId?: string,
  ): Promise<ExpireIntentsBatchResult> {
    const batchSize = this.resolveExpirationBatchSize(limit);
    const now = new Date();
    const batchCorrelationId = correlationId?.trim() || randomUUID();
    const result: ExpireIntentsBatchResult = {
      scanned: 0,
      expired: 0,
      reconcileRequired: 0,
      skipped: 0,
      failed: 0,
    };

    const dueIntents = await this.dbService.db
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(
        and(
          inArray(paymentIntents.status, [
            'PENDING',
            'IN_PROGRESS',
            'PARTIALLY_CAPTURED',
          ]),
          lte(paymentIntents.expiresAt, now),
        ),
      )
      .orderBy(asc(paymentIntents.expiresAt))
      .limit(batchSize);

    result.scanned = dueIntents.length;

    for (const intent of dueIntents) {
      const intentCorrelationId = `${batchCorrelationId}:expire:${intent.id}`;
      try {
        const expired = await this.expireIntent(intent.id, intentCorrelationId);
        if (expired.status === 'EXPIRED') {
          result.expired += 1;
          continue;
        }
        if (expired.status === 'RECONCILE_REQUIRED') {
          result.reconcileRequired += 1;
          continue;
        }
        result.skipped += 1;
      } catch (error) {
        if (this.isExpirationSkippableConflict(error)) {
          result.skipped += 1;
          continue;
        }
        result.failed += 1;
      }
    }

    return result;
  }

  private async prepareCompensationIntentLegs(
    tx: DbTx,
    intent: LockedIntent,
    correlationId: string,
    reason: TerminationReason,
  ): Promise<CompensationPrepareResult> {
    const legs = await tx
      .select()
      .from(paymentLegs)
      .where(eq(paymentLegs.intentId, intent.id));

    let hasFailure = false;
    const manualQueueItemIds = new Set<string>();
    const operations: PreparedCompensationOperation[] = [];

    const cancelTargets = legs.filter((leg) => leg.status === 'AUTHORIZED');
    const refundTargets = legs
      .filter((leg) => leg.status === 'CAPTURED')
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    const nonMonetaryTargets = legs.filter(
      (leg) => leg.status !== 'AUTHORIZED' && leg.status !== 'CAPTURED',
    );

    for (const leg of cancelTargets) {
      operations.push(
        await this.prepareCompensationLegOperation(
          tx,
          intent,
          leg,
          'CANCEL',
          correlationId,
          reason,
        ),
      );
    }

    for (const leg of refundTargets) {
      operations.push(
        await this.prepareCompensationLegOperation(
          tx,
          intent,
          leg,
          'REFUND',
          correlationId,
          reason,
        ),
      );
    }

    for (const leg of nonMonetaryTargets) {
      switch (leg.status) {
        case 'READY':
        case 'PROCESSING':
        case 'REQUIRES_CUSTOMER_ACTION':
        case 'REQUIRES_ADMIN_CONFIRMATION': {
          const preCaptureReasonCode =
            reason === 'CANCEL'
              ? 'LEG_CANCELLED_BEFORE_CAPTURE'
              : reason === 'SUPERSEDE'
                ? 'LEG_SUPERSEDED_BEFORE_CAPTURE'
                : 'LEG_EXPIRED_BEFORE_CAPTURE';
          const preCaptureReasonMessage =
            reason === 'CANCEL'
              ? 'Leg expired due to intent cancellation before capture'
              : reason === 'SUPERSEDE'
                ? 'Leg expired due to intent supersede before capture'
                : 'Leg expired due to intent expiration before capture';

          await this.stateTransitionService.transitionLeg(
            leg.id,
            'EXPIRED',
            {
              correlationId,
              reasonCode: preCaptureReasonCode,
              reasonMessage: preCaptureReasonMessage,
              triggeredByType: 'SYSTEM',
              triggeredById: intent.customerId,
              payload: {
                operation: reason,
              },
            },
            leg.status,
            tx,
          );
          break;
        }
        case 'CANCELING':
        case 'REFUNDING': {
          hasFailure = true;
          const queueItemId = await this.upsertManualQueueItem(tx, {
            intentId: intent.id,
            legId: leg.id,
            actionType: leg.status === 'REFUNDING' ? 'REFUND' : 'CANCEL',
            correlationId,
            requestedBy: intent.customerId,
            reasonCode: 'LEG_RECONCILE_REQUIRED',
            reasonMessage: `Leg remained ${leg.status} during ${reason} compensation`,
          });
          manualQueueItemIds.add(queueItemId);
          break;
        }
        case 'RECONCILE_REQUIRED': {
          hasFailure = true;
          break;
        }
        default:
          break;
      }
    }

    return {
      hasFailure,
      manualQueueItemIds: [...manualQueueItemIds],
      operations,
    };
  }

  private async prepareCompensationLegOperation(
    tx: DbTx,
    intent: LockedIntent,
    leg: PaymentLeg,
    operation: 'CANCEL' | 'REFUND',
    correlationId: string,
    reason: TerminationReason,
  ): Promise<PreparedCompensationOperation> {
    const attempt = await this.createAttempt(tx, {
      intentId: intent.id,
      legId: leg.id,
      operation,
      correlationId,
      triggeredById: intent.customerId,
    });

    await this.stateTransitionService.transitionAttempt(
      attempt.id,
      'SENT',
      {
        correlationId,
        causationId: leg.id,
        reasonCode: `PROVIDER_${operation}_REQUEST_SENT`,
        reasonMessage: `Provider ${operation} request sent`,
        triggeredByType: 'SYSTEM',
        triggeredById: intent.customerId,
        payload: {
          operation,
          terminationReason: reason,
        },
      },
      'CREATED',
      tx,
    );

    const requestedStatus = operation === 'CANCEL' ? 'CANCEL_REQUESTED' : 'REFUND_REQUESTED';
    await this.stateTransitionService.transitionAttempt(
      attempt.id,
      requestedStatus,
      {
        correlationId,
        causationId: leg.id,
        reasonCode: `PROVIDER_${operation}_REQUEST_ACCEPTED`,
        reasonMessage: `${operation} request accepted for provider call`,
        triggeredByType: 'SYSTEM',
        triggeredById: intent.customerId,
        payload: {
          operation,
          terminationReason: reason,
        },
      },
      'SENT',
      tx,
    );

    await this.stateTransitionService.transitionLeg(
      leg.id,
      'CANCELING',
      {
        correlationId,
        reasonCode:
          reason === 'CANCEL'
            ? `LEG_${operation}_STARTED`
            : reason === 'SUPERSEDE'
              ? `LEG_SUPERSEDE_${operation}`
              : `LEG_EXPIRE_${operation}`,
        reasonMessage:
          reason === 'CANCEL'
            ? `${operation} compensation started`
            : reason === 'SUPERSEDE'
              ? `${operation} compensation started for supersede`
              : `${operation} compensation started for expiration`,
        triggeredByType: 'SYSTEM',
        triggeredById: intent.customerId,
        payload: {
          operation,
          terminationReason: reason,
        },
      },
      leg.status,
      tx,
    );

    return {
      attemptId: attempt.id,
      providerIdempotencyKey: attempt.providerIdempotencyKey,
      legId: leg.id,
      providerType: leg.providerType,
      amount: leg.amount,
      metadata: leg.metadata,
      operation,
      requestedStatus,
    };
  }

  private async executeCompensationOperations(
    intent: LockedIntent,
    operations: PreparedCompensationOperation[],
    correlationId: string,
    reason: TerminationReason,
  ): Promise<CompensationExecutionResult> {
    let hasFailure = false;
    const manualQueueItemIds = new Set<string>();

    for (const operation of operations) {
      const result = await this.executeCompensationOperation(
        intent,
        operation,
        correlationId,
        reason,
      );

      hasFailure = hasFailure || result.failed;
      if (result.manualQueueItemId) {
        manualQueueItemIds.add(result.manualQueueItemId);
      }
    }

    return {
      hasFailure,
      manualQueueItemIds: [...manualQueueItemIds],
    };
  }

  private async executeCompensationOperation(
    intent: LockedIntent,
    operation: PreparedCompensationOperation,
    correlationId: string,
    reason: TerminationReason,
  ): Promise<CompensationLegResult> {
    try {
      const provider = this.providerRegistry.assertCapability(
        operation.providerType,
        operation.operation,
        {
          intentId: intent.id,
          legId: operation.legId,
        },
      );

      const command =
        operation.operation === 'CANCEL'
          ? {
              op: 'CANCEL' as const,
              params: {
                intentId: intent.id,
                legId: operation.legId,
                attemptId: operation.attemptId,
                idempotencyKey: operation.providerIdempotencyKey,
                amount: operation.amount,
                currency: intent.currency,
                customerId: intent.customerId,
                correlationId,
                metadata: operation.metadata,
              },
            }
          : {
              op: 'REFUND' as const,
              params: {
                intentId: intent.id,
                legId: operation.legId,
                attemptId: operation.attemptId,
                idempotencyKey: operation.providerIdempotencyKey,
                amount: operation.amount,
                currency: intent.currency,
                customerId: intent.customerId,
                correlationId,
                metadata: operation.metadata,
              },
            };

      const providerResult = await provider.execute(command);

      return this.dbService.db.transaction(async (tx) => {
        await this.persistProviderAttemptResult(tx, operation.attemptId, providerResult);

        const successStatus =
          operation.operation === 'CANCEL' ? ('CANCELLED' as const) : ('REFUNDED' as const);
        const isSuccess = providerResult.resultStatus === successStatus;

        if (!isSuccess) {
          await this.persistProviderAttemptFailure(
            tx,
            operation.attemptId,
            `PROVIDER_${operation.operation}_FAILED`,
            `${operation.operation} returned unexpected status ${providerResult.resultStatus}`,
          );

          await this.stateTransitionService.transitionAttempt(
            operation.attemptId,
            'FAILED_FINAL',
            {
              correlationId,
              causationId: operation.legId,
              reasonCode: `PROVIDER_${operation.operation}_FAILED`,
              reasonMessage: `${operation.operation} returned unexpected status ${providerResult.resultStatus}`,
              triggeredByType: 'SYSTEM',
              triggeredById: intent.customerId,
              payload: {
                operation: operation.operation,
                providerResultStatus: providerResult.resultStatus,
                terminationReason: reason,
              },
            },
            operation.requestedStatus,
            tx,
          );

          await this.stateTransitionService.transitionLeg(
            operation.legId,
            'RECONCILE_REQUIRED',
            {
              correlationId,
              reasonCode: `LEG_${operation.operation}_FAILED`,
              reasonMessage: `${operation.operation} returned unexpected status ${providerResult.resultStatus}`,
              triggeredByType: 'SYSTEM',
              triggeredById: intent.customerId,
              payload: {
                operation: operation.operation,
                providerResultStatus: providerResult.resultStatus,
                terminationReason: reason,
              },
            },
            'CANCELING',
            tx,
          );

          const queueItemId = await this.upsertManualQueueItem(tx, {
            intentId: intent.id,
            legId: operation.legId,
            actionType: operation.operation,
            correlationId,
            requestedBy: intent.customerId,
            reasonCode: `LEG_${operation.operation}_FAILED`,
            reasonMessage: `${operation.operation} returned unexpected status ${providerResult.resultStatus}`,
          });
          return { failed: true, manualQueueItemId: queueItemId };
        }

        await this.stateTransitionService.transitionAttempt(
          operation.attemptId,
          successStatus,
          {
            correlationId,
            causationId: operation.legId,
            reasonCode: `PROVIDER_${operation.operation}_SUCCEEDED`,
            reasonMessage: `${operation.operation} compensation succeeded`,
            triggeredByType: 'SYSTEM',
            triggeredById: intent.customerId,
            payload: {
              operation: operation.operation,
              providerTransactionId: providerResult.providerTransactionId,
              terminationReason: reason,
            },
          },
          operation.requestedStatus,
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          operation.legId,
          successStatus,
          {
            correlationId,
            reasonCode: `LEG_${operation.operation}_SUCCEEDED`,
            reasonMessage: `${operation.operation} compensation succeeded`,
            triggeredByType: 'SYSTEM',
            triggeredById: intent.customerId,
            payload: {
              operation: operation.operation,
              providerTransactionId: providerResult.providerTransactionId,
              terminationReason: reason,
            },
          },
          'CANCELING',
          tx,
        );

        return { failed: false };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : `${operation.operation} provider call failed`;

      return this.dbService.db.transaction(async (tx) => {
        await this.persistProviderAttemptFailure(
          tx,
          operation.attemptId,
          `PROVIDER_${operation.operation}_FAILED`,
          errorMessage,
        );
        await this.stateTransitionService.transitionAttempt(
          operation.attemptId,
          'FAILED_RETRYABLE',
          {
            correlationId,
            causationId: operation.legId,
            reasonCode: `PROVIDER_${operation.operation}_FAILED`,
            reasonMessage: errorMessage,
            triggeredByType: 'SYSTEM',
            triggeredById: intent.customerId,
            payload: {
              operation: operation.operation,
              terminationReason: reason,
            },
          },
          operation.requestedStatus,
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          operation.legId,
          'RECONCILE_REQUIRED',
          {
            correlationId,
            reasonCode: `LEG_${operation.operation}_FAILED`,
            reasonMessage: errorMessage,
            triggeredByType: 'SYSTEM',
            triggeredById: intent.customerId,
            payload: {
              operation: operation.operation,
              terminationReason: reason,
            },
          },
          'CANCELING',
          tx,
        );

        const queueItemId = await this.upsertManualQueueItem(tx, {
          intentId: intent.id,
          legId: operation.legId,
          actionType: operation.operation,
          correlationId,
          requestedBy: intent.customerId,
          reasonCode: `LEG_${operation.operation}_FAILED`,
          reasonMessage: errorMessage,
        });

        return { failed: true, manualQueueItemId: queueItemId };
      });
    }
  }

  private async upsertManualQueueItem(
    tx: DbTx,
    input: {
      intentId: string;
      legId: string;
      actionType: ManualActionType;
      correlationId: string;
      requestedBy: string;
      reasonCode: string;
      reasonMessage: string;
    },
  ): Promise<string> {
    return this.manualActionQueueService.upsertManualQueueItem(tx, {
      ...input,
      triggeredById: input.requestedBy,
      creationReasonMessage: 'Manual queue item created for reconcile',
    });
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

  private resolveExpirationBatchSize(limit?: number): number {
    const parsed =
      limit ?? Number(process.env.WALLET_EXPIRATION_BATCH_SIZE ?? '50');

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 50;
    }

    return Math.floor(parsed);
  }

  private isExpirationSkippableConflict(error: unknown): boolean {
    if (!(error instanceof ConflictException)) {
      return false;
    }

    const response = error.getResponse();
    const errorCode =
      typeof response === 'object' && response && 'error' in response
        ? (response as { error?: string }).error
        : undefined;

    return (
      errorCode === 'INTENT_STATE_INVALID_FOR_EXPIRE' ||
      errorCode === 'INTENT_NOT_EXPIRED'
    );
  }

  private assertIntentCanCancel(status: PaymentIntentStatus): void {
    if (
      status !== 'PENDING' &&
      status !== 'IN_PROGRESS' &&
      status !== 'PARTIALLY_CAPTURED'
    ) {
      throw new ConflictException({
        error: 'INTENT_STATE_INVALID_FOR_CANCEL',
        message: `Intent status ${status} cannot be cancelled`,
      });
    }
  }

  private assertIntentCanSupersede(status: PaymentIntentStatus): void {
    if (
      status !== 'PENDING' &&
      status !== 'IN_PROGRESS' &&
      status !== 'PARTIALLY_CAPTURED'
    ) {
      throw new ConflictException({
        error: 'INTENT_STATE_INVALID_FOR_SUPERSEDE',
        message: `Intent status ${status} cannot be superseded`,
      });
    }
  }

  private assertIntentCanExpire(status: PaymentIntentStatus): void {
    if (
      status !== 'PENDING' &&
      status !== 'IN_PROGRESS' &&
      status !== 'PARTIALLY_CAPTURED'
    ) {
      throw new ConflictException({
        error: 'INTENT_STATE_INVALID_FOR_EXPIRE',
        message: `Intent status ${status} cannot be expired`,
      });
    }
  }
}
