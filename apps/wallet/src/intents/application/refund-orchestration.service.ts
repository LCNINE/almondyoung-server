import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { CreateRefundRequestDto } from '../dto/create-refund-request.dto';
import {
  PaymentIntentStatus,
  PaymentReferenceType,
  RefundRequestStatus,
  WalletSchema,
  outboxEvents,
  paymentIntents,
  paymentLegs,
  paymentStateTransitions,
  refundAllocations,
  refundRequests,
} from '../../schema';
import {
  DbTx,
  PaymentAttempt,
  PaymentIntent,
  PaymentLeg,
} from '../../types';
import { ProviderRegistry } from '../../providers/provider.registry';
import {
  ProviderOperation,
  ProviderOperationResult,
} from '../../providers/payment-provider.types';
import { StateTransitionService } from '../../domain/state-transition/state-transition.service';
import { buildOutboxInsertValues } from '../../messaging/outbox-event.util';
import {
  buildPaymentIntentEventPayload,
  buildRefundEventPayload,
} from '../../messaging/payments-event.builder';
import { AttemptService } from '../support/attempt.service';
import {
  ManualActionQueueService,
  ManualActionType,
} from '../support/manual-action-queue.service';
import { RefundRequestDetailResult } from './intents.service.types';

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
  userId: string;
  payableAmount: number;
  currency: string;
}

interface LockedIntent {
  id: string;
  referenceType: PaymentReferenceType;
  referenceId: string;
  userId: string;
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
  status: PaymentLeg['status'];
  version: number;
  metadata: Record<string, unknown>;
}

interface PreparedRefundAllocation {
  attemptId: string;
  providerIdempotencyKey: string;
  legId: string;
  providerType: string;
  metadata: Record<string, unknown>;
  allocationAmount: number;
  shouldFullyRefundLeg: boolean;
  requestedBy: string;
  reasonCode: string;
  reasonMessage?: string;
}

const REFUND_LIMIT_BLOCKING_STATUSES: RefundRequestStatus[] = [
  'REQUESTED',
  'VALIDATED',
  'PROCESSING',
  'PARTIALLY_COMPLETED',
  'COMPLETED',
  'RECONCILE_REQUIRED',
];

@Injectable()
export class RefundOrchestrationService {
  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly providerRegistry: ProviderRegistry,
    private readonly stateTransitionService: StateTransitionService,
    private readonly attemptService: AttemptService,
    private readonly manualActionQueueService: ManualActionQueueService,
  ) {}

  async createRefundRequest(
    intentId: string,
    dto: CreateRefundRequestDto,
    correlationId?: string,
    actorId?: string,
  ): Promise<RefundRequestDetailResult> {
    const requestCorrelationId = correlationId?.trim() || randomUUID();
    const requestedBy = actorId?.trim() || 'system';
    const totalAllocationAmount = dto.allocation.reduce(
      (sum, item) => sum + item.amount,
      0,
    );

    if (totalAllocationAmount !== dto.refundAmount) {
      throw new BadRequestException({
        error: 'ALLOCATION_INVALID',
        message: `sum(allocation.amount) must equal refundAmount: expected=${dto.refundAmount}, actual=${totalAllocationAmount}`,
      });
    }

    const allocationLegIds = dto.allocation.map((item) => item.legId);
    if (new Set(allocationLegIds).size !== allocationLegIds.length) {
      throw new BadRequestException({
        error: 'ALLOCATION_INVALID',
        message: 'allocation must not contain duplicate legId',
      });
    }

    const prepared = await this.dbService.db.transaction(async (tx) => {
      const intent = await this.lockIntentForRefundOrThrow(intentId, tx);
      const lockedLegs = await this.lockLegsForRefund(intentId, allocationLegIds, tx);

      if (lockedLegs.length !== allocationLegIds.length) {
        throw new NotFoundException({
          error: 'LEG_NOT_FOUND',
          message: 'Some allocation legs were not found for this intent',
        });
      }

      const refundedByLegId = await this.readRefundedAmountByLegId(
        intentId,
        allocationLegIds,
        tx,
      );
      const legsById = new Map(lockedLegs.map((leg) => [leg.id, leg]));

      for (const allocation of dto.allocation) {
        const leg = legsById.get(allocation.legId);
        if (!leg) {
          throw new NotFoundException({
            error: 'LEG_NOT_FOUND',
            message: `Payment leg not found: ${allocation.legId}`,
          });
        }

        if (leg.status !== 'CAPTURED') {
          throw new BadRequestException({
            error: 'ALLOCATION_INVALID',
            message: `Allocation target leg must be CAPTURED: legId=${allocation.legId}, status=${leg.status}`,
          });
        }

        const alreadyRefunded = refundedByLegId.get(leg.id) ?? 0;
        if (alreadyRefunded + allocation.amount > leg.amount) {
          throw new BadRequestException({
            error: 'REFUND_LIMIT_EXCEEDED',
            message: `Refund limit exceeded for leg=${leg.id}: captured=${leg.amount}, refunded=${alreadyRefunded}, requested=${allocation.amount}`,
          });
        }
      }

      const [createdRefundRequest] = await tx
        .insert(refundRequests)
        .values({
          intentId,
          referenceType: intent.referenceType,
          referenceId: intent.referenceId,
          status: 'REQUESTED',
          refundAmount: dto.refundAmount,
          currency: intent.currency,
          reasonCode: dto.reasonCode,
          reasonMessage: dto.reasonMessage,
          requestedBy,
          metadata: {},
        })
        .returning();

      const createdAllocations = await tx
        .insert(refundAllocations)
        .values(
          dto.allocation.map((item) => ({
            refundRequestId: createdRefundRequest.id,
            intentId,
            legId: item.legId,
            amount: item.amount,
          })),
        )
        .returning();

      await tx.insert(paymentStateTransitions).values({
        entityType: 'REFUND_REQUEST',
        entityId: createdRefundRequest.id,
        previousStatus: null,
        newStatus: 'REQUESTED',
        reasonCode: 'REFUND_REQUEST_CREATED',
        reasonMessage: 'Refund request created',
        triggeredByType: 'USER',
        triggeredById: requestedBy,
        correlationId: requestCorrelationId,
        occurredAt: new Date(),
        payload: {
          intentId,
          refundAmount: dto.refundAmount,
          allocation: dto.allocation,
        },
      });

      await this.stateTransitionService.transitionRefundRequest(
        createdRefundRequest.id,
        'VALIDATED',
        {
          correlationId: requestCorrelationId,
          reasonCode: 'REFUND_REQUEST_VALIDATED',
          reasonMessage: 'Refund allocation validated',
          triggeredByType: 'SYSTEM',
          triggeredById: requestedBy,
          payload: {
            intentId,
            allocationCount: dto.allocation.length,
          },
        },
        'REQUESTED',
        tx,
      );

      await this.stateTransitionService.transitionRefundRequest(
        createdRefundRequest.id,
        'PROCESSING',
        {
          correlationId: requestCorrelationId,
          reasonCode: 'REFUND_REQUEST_PROCESSING_STARTED',
          reasonMessage: 'Refund processing started',
          triggeredByType: 'SYSTEM',
          triggeredById: requestedBy,
          payload: {
            intentId,
          },
          outboxEvent: {
            eventType: 'RefundRequested',
            aggregateType: 'RefundRequest',
            aggregateId: createdRefundRequest.id,
            partitionKey: intentId,
            payload: buildRefundEventPayload({
              refundId: createdRefundRequest.id,
              intentId,
              referenceType: intent.referenceType,
              referenceId: intent.referenceId,
              userId: intent.userId,
              refundAmount: dto.refundAmount,
              currency: intent.currency,
              allocation: dto.allocation,
            }),
          },
        },
        'VALIDATED',
        tx,
      );

      const preparedAllocations: PreparedRefundAllocation[] = [];

      for (const allocation of dto.allocation) {
        const leg = legsById.get(allocation.legId)!;
        const alreadyRefunded = refundedByLegId.get(leg.id) ?? 0;
        const shouldFullyRefundLeg = alreadyRefunded + allocation.amount >= leg.amount;

        const attempt = await this.createAttempt(tx, {
          intentId: intent.id,
          legId: leg.id,
          operation: 'REFUND',
          correlationId: requestCorrelationId,
          triggeredById: requestedBy,
        });

        await this.stateTransitionService.transitionAttempt(
          attempt.id,
          'SENT',
          {
            correlationId: requestCorrelationId,
            causationId: leg.id,
            reasonCode: 'PROVIDER_REFUND_REQUEST_SENT',
            reasonMessage: 'Provider refund request sent',
            triggeredByType: 'SYSTEM',
            triggeredById: requestedBy,
            payload: {
              operation: 'REFUND',
              amount: allocation.amount,
            },
          },
          'CREATED',
          tx,
        );

        await this.stateTransitionService.transitionAttempt(
          attempt.id,
          'REFUND_REQUESTED',
          {
            correlationId: requestCorrelationId,
            causationId: leg.id,
            reasonCode: 'PROVIDER_REFUND_REQUEST_ACCEPTED',
            reasonMessage: 'Provider refund request accepted',
            triggeredByType: 'SYSTEM',
            triggeredById: requestedBy,
            payload: {
              operation: 'REFUND',
              amount: allocation.amount,
            },
          },
          'SENT',
          tx,
        );

        preparedAllocations.push({
          attemptId: attempt.id,
          providerIdempotencyKey: attempt.providerIdempotencyKey,
          legId: leg.id,
          providerType: leg.providerType,
          metadata: leg.metadata,
          allocationAmount: allocation.amount,
          shouldFullyRefundLeg,
          requestedBy,
          reasonCode: dto.reasonCode,
          reasonMessage: dto.reasonMessage,
        });
      }

      return {
        intent,
        refundRequestId: createdRefundRequest.id,
        allocations: createdAllocations,
        preparedAllocations,
      };
    });

    let hasFailure = false;
    let successCount = 0;
    const manualQueueItemIds = new Set<string>();

    for (const allocation of prepared.preparedAllocations) {
      const result = await this.executePreparedRefundAllocation(
        prepared.intent,
        allocation,
        requestCorrelationId,
      );

      if (result.failed) {
        hasFailure = true;
        if (result.manualQueueItemId) {
          manualQueueItemIds.add(result.manualQueueItemId);
        }
      } else {
        successCount += 1;
      }
    }

    const uniqueManualQueueItemIds = [...manualQueueItemIds];

    await this.dbService.db.transaction(async (tx) => {
      if (!hasFailure) {
        await this.stateTransitionService.transitionRefundRequest(
          prepared.refundRequestId,
          'COMPLETED',
          {
            correlationId: requestCorrelationId,
            reasonCode: 'REFUND_REQUEST_COMPLETED',
            reasonMessage: 'Refund request completed',
            triggeredByType: 'SYSTEM',
            triggeredById: requestedBy,
            payload: {
              intentId,
              successfulAllocationCount: successCount,
            },
            outboxEvent: {
              eventType: 'RefundCompleted',
              aggregateType: 'RefundRequest',
              aggregateId: prepared.refundRequestId,
              partitionKey: intentId,
              payload: buildRefundEventPayload({
                refundId: prepared.refundRequestId,
                intentId,
                referenceType: prepared.intent.referenceType,
                referenceId: prepared.intent.referenceId,
                userId: prepared.intent.userId,
                refundAmount: dto.refundAmount,
                currency: prepared.intent.currency,
                allocation: dto.allocation,
              }),
            },
          },
          'PROCESSING',
          tx,
        );
        return;
      }

      let currentRefundStatus: RefundRequestStatus = 'PROCESSING';

      if (successCount > 0) {
        await this.stateTransitionService.transitionRefundRequest(
          prepared.refundRequestId,
          'PARTIALLY_COMPLETED',
          {
            correlationId: requestCorrelationId,
            reasonCode: 'REFUND_REQUEST_PARTIALLY_COMPLETED',
            reasonMessage: 'Some allocations were refunded before failure',
            triggeredByType: 'SYSTEM',
            triggeredById: requestedBy,
            payload: {
              intentId,
              successfulAllocationCount: successCount,
            },
          },
          'PROCESSING',
          tx,
        );
        currentRefundStatus = 'PARTIALLY_COMPLETED';
      }

      await this.stateTransitionService.transitionRefundRequest(
        prepared.refundRequestId,
        'RECONCILE_REQUIRED',
        {
          correlationId: requestCorrelationId,
          reasonCode: 'REFUND_REQUEST_RECONCILE_REQUIRED',
          reasonMessage: 'Refund request requires manual reconcile',
          triggeredByType: 'SYSTEM',
          triggeredById: requestedBy,
          payload: {
            intentId,
            successfulAllocationCount: successCount,
            failedAllocationCount: prepared.preparedAllocations.length - successCount,
            manualQueueItemIds: uniqueManualQueueItemIds,
          },
          outboxEvent: {
            eventType: 'RefundFailed',
            aggregateType: 'RefundRequest',
            aggregateId: prepared.refundRequestId,
            partitionKey: intentId,
            payload: buildRefundEventPayload({
              refundId: prepared.refundRequestId,
              intentId,
              referenceType: prepared.intent.referenceType,
              referenceId: prepared.intent.referenceId,
              userId: prepared.intent.userId,
              refundAmount: dto.refundAmount,
              currency: prepared.intent.currency,
              allocation: dto.allocation,
              extra: {
                reasonCode: 'REFUND_REQUEST_RECONCILE_REQUIRED',
                reasonMessage: 'Refund request requires manual reconcile',
                requiresManualAction: true,
                manualQueueItemId: uniqueManualQueueItemIds[0] ?? null,
                manualQueueItemIds: uniqueManualQueueItemIds,
              },
            }),
          },
        },
        currentRefundStatus,
        tx,
      );

      await tx.insert(outboxEvents).values(
        buildOutboxInsertValues(
          this.buildPaymentIntentOutboxEvent(
            prepared.intent,
            'PaymentReconcileRequired',
            'RECONCILE_REQUIRED',
            {
              reasonCode: 'REFUND_REQUEST_RECONCILE_REQUIRED',
              reasonMessage: 'Refund request requires manual reconcile',
              requiresManualAction: true,
              manualQueueItemId: uniqueManualQueueItemIds[0] ?? null,
              manualQueueItemIds: uniqueManualQueueItemIds,
            },
          ),
        ),
      );
    });

    const refreshedRows = await this.dbService.db
      .select()
      .from(refundRequests)
      .where(eq(refundRequests.id, prepared.refundRequestId))
      .limit(1);
    const refreshedRefundRequest = refreshedRows[0];

    if (!refreshedRefundRequest) {
      throw new Error(`REFUND_REQUEST_NOT_FOUND: ${prepared.refundRequestId}`);
    }

    return {
      refundRequest: refreshedRefundRequest,
      allocations: prepared.allocations,
    };
  }

  async getRefundRequest(refundId: string): Promise<RefundRequestDetailResult> {
    const rows = await this.dbService.db
      .select()
      .from(refundRequests)
      .where(eq(refundRequests.id, refundId))
      .limit(1);
    const refundRequest = rows[0];

    if (!refundRequest) {
      throw new NotFoundException({
        error: 'REFUND_REQUEST_NOT_FOUND',
        message: `Refund request not found: ${refundId}`,
      });
    }

    const allocations = await this.dbService.db
      .select()
      .from(refundAllocations)
      .where(eq(refundAllocations.refundRequestId, refundId));

    return {
      refundRequest,
      allocations,
    };
  }

  private async executePreparedRefundAllocation(
    intent: LockedIntent,
    allocation: PreparedRefundAllocation,
    correlationId: string,
  ): Promise<{ failed: boolean; manualQueueItemId?: string }> {
    try {
      const provider = this.providerRegistry.assertCapability(
        allocation.providerType,
        'REFUND',
        {
          intentId: intent.id,
          legId: allocation.legId,
        },
      );

      const providerResult = await provider.execute({
        op: 'REFUND',
        params: {
          intentId: intent.id,
          legId: allocation.legId,
          attemptId: allocation.attemptId,
          idempotencyKey: allocation.providerIdempotencyKey,
          amount: allocation.allocationAmount,
          currency: intent.currency,
          userId: intent.userId,
          correlationId,
          metadata: allocation.metadata,
        },
      });

      return this.dbService.db.transaction(async (tx) => {
        await this.persistProviderAttemptResult(tx, allocation.attemptId, providerResult);

        if (providerResult.resultStatus !== 'REFUNDED') {
          const queueItemId = await this.markRefundFailureForLeg(tx, {
            intentId: intent.id,
            legId: allocation.legId,
            attemptId: allocation.attemptId,
            correlationId,
            requestedBy: allocation.requestedBy,
            reasonCode: 'PROVIDER_REFUND_FAILED',
            reasonMessage: `Unexpected provider refund status: ${providerResult.resultStatus}`,
          });
          return { failed: true, manualQueueItemId: queueItemId };
        }

        await this.stateTransitionService.transitionAttempt(
          allocation.attemptId,
          'REFUNDED',
          {
            correlationId,
            causationId: allocation.legId,
            reasonCode: 'PROVIDER_REFUND_SUCCEEDED',
            reasonMessage: 'Provider refund succeeded',
            triggeredByType: 'SYSTEM',
            triggeredById: allocation.requestedBy,
            payload: {
              operation: 'REFUND',
              amount: allocation.allocationAmount,
              providerTransactionId: providerResult.providerTransactionId,
            },
          },
          'REFUND_REQUESTED',
          tx,
        );

        if (allocation.shouldFullyRefundLeg) {
          await this.stateTransitionService.transitionLeg(
            allocation.legId,
            'REFUNDING',
            {
              correlationId,
              reasonCode: 'LEG_REFUNDING_STARTED',
              reasonMessage: 'Leg refunding started',
              triggeredByType: 'SYSTEM',
              triggeredById: allocation.requestedBy,
              payload: {
                operation: 'REFUND',
                amount: allocation.allocationAmount,
              },
            },
            'CAPTURED',
            tx,
          );

          await this.stateTransitionService.transitionLeg(
            allocation.legId,
            'REFUNDED',
            {
              correlationId,
              reasonCode: 'LEG_REFUNDED',
              reasonMessage: 'Leg refunded',
              triggeredByType: 'SYSTEM',
              triggeredById: allocation.requestedBy,
              payload: {
                operation: 'REFUND',
                amount: allocation.allocationAmount,
                reasonCode: allocation.reasonCode,
                reasonMessage: allocation.reasonMessage ?? null,
              },
            },
            'REFUNDING',
            tx,
          );
        }

        return { failed: false };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Provider refund call failed';

      return this.dbService.db.transaction(async (tx) => {
        const queueItemId = await this.markRefundFailureForLeg(tx, {
          intentId: intent.id,
          legId: allocation.legId,
          attemptId: allocation.attemptId,
          correlationId,
          requestedBy: allocation.requestedBy,
          reasonCode: 'PROVIDER_REFUND_FAILED',
          reasonMessage: errorMessage,
        });
        return { failed: true, manualQueueItemId: queueItemId };
      });
    }
  }

  private async markRefundFailureForLeg(
    tx: DbTx,
    input: {
      intentId: string;
      legId: string;
      attemptId: string;
      correlationId: string;
      requestedBy: string;
      reasonCode: string;
      reasonMessage: string;
    },
  ): Promise<string> {
    await this.persistProviderAttemptFailure(
      tx,
      input.attemptId,
      input.reasonCode,
      input.reasonMessage,
    );

    await this.stateTransitionService.transitionAttempt(
      input.attemptId,
      'FAILED_RETRYABLE',
      {
        correlationId: input.correlationId,
        causationId: input.legId,
        reasonCode: input.reasonCode,
        reasonMessage: input.reasonMessage,
        triggeredByType: 'SYSTEM',
        triggeredById: input.requestedBy,
        payload: {
          operation: 'REFUND',
        },
      },
      'REFUND_REQUESTED',
      tx,
    );

    await this.stateTransitionService.transitionLeg(
      input.legId,
      'REFUNDING',
      {
        correlationId: input.correlationId,
        reasonCode: 'LEG_REFUNDING_STARTED',
        reasonMessage: 'Leg refunding started',
        triggeredByType: 'SYSTEM',
        triggeredById: input.requestedBy,
        payload: {
          operation: 'REFUND',
        },
      },
      'CAPTURED',
      tx,
    );

    await this.stateTransitionService.transitionLeg(
      input.legId,
      'RECONCILE_REQUIRED',
      {
        correlationId: input.correlationId,
        reasonCode: 'LEG_REFUND_FAILED',
        reasonMessage: input.reasonMessage,
        triggeredByType: 'SYSTEM',
        triggeredById: input.requestedBy,
        payload: {
          operation: 'REFUND',
          reasonCode: input.reasonCode,
        },
      },
      'REFUNDING',
      tx,
    );

    return this.upsertManualQueueItem(tx, {
      intentId: input.intentId,
      legId: input.legId,
      actionType: 'REFUND',
      correlationId: input.correlationId,
      requestedBy: input.requestedBy,
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
    });
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
        userId: intent.userId,
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
        user_id as "userId",
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

  private async lockIntentForRefundOrThrow(
    intentId: string,
    tx: DbTx,
  ): Promise<LockedIntent> {
    const intent = await this.lockIntentOrThrow(intentId, tx);

    if (intent.status !== 'PARTIALLY_CAPTURED' && intent.status !== 'SUCCEEDED') {
      throw new ConflictException({
        error: 'INTENT_STATE_INVALID_FOR_REFUND',
        message: `Intent status ${intent.status} cannot request refund`,
      });
    }

    return intent;
  }

  private async lockLegsForRefund(
    intentId: string,
    legIds: string[],
    tx: DbTx,
  ): Promise<LockedLeg[]> {
    if (legIds.length === 0) {
      return [];
    }

    const legIdBindings = legIds.map((id) => sql`${id}`);
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
        and id in (${sql.join(legIdBindings, sql`, `)})
      for update
    `)) as unknown as LockedLeg[];

    return rows;
  }

  private async readRefundedAmountByLegId(
    intentId: string,
    legIds: string[],
    tx: DbTx,
  ): Promise<Map<string, number>> {
    if (legIds.length === 0) {
      return new Map<string, number>();
    }

    const rows = await tx
      .select({
        legId: refundAllocations.legId,
        refundedAmount: sql<number>`coalesce(sum(${refundAllocations.amount}), 0)`,
      })
      .from(refundAllocations)
      .innerJoin(
        refundRequests,
        eq(refundAllocations.refundRequestId, refundRequests.id),
      )
      .where(
        and(
          eq(refundAllocations.intentId, intentId),
          inArray(refundAllocations.legId, legIds),
          inArray(refundRequests.status, REFUND_LIMIT_BLOCKING_STATUSES),
        ),
      )
      .groupBy(refundAllocations.legId);

    const refundedByLegId = new Map<string, number>();
    for (const row of rows) {
      refundedByLegId.set(row.legId, Number(row.refundedAmount ?? 0));
    }

    return refundedByLegId;
  }
}
