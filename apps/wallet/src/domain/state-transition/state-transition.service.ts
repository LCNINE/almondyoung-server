import { ConflictException, Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { generateMessageId } from '@app/events';
import { eq, sql } from 'drizzle-orm';
import {
  WalletSchema,
  outboxEvents,
  paymentAttempts,
  paymentIntents,
  paymentLegs,
  paymentStateTransitions,
  refundRequests,
  manualCancelQueueItems,
  PaymentAttemptStatus,
  PaymentIntentStatus,
  PaymentLegStatus,
  PaymentStateTriggerType,
  RefundRequestStatus,
  ManualCancelQueueStatus,
  PaymentStateEntityType,
} from '../../schema';
import { DbTx } from '../../types';
import { inTx } from '../../database/tx.util';
import { assertTransitionAllowed } from './state-transition.rules';

type TransitionTargetStatus =
  | PaymentIntentStatus
  | PaymentLegStatus
  | PaymentAttemptStatus
  | RefundRequestStatus
  | ManualCancelQueueStatus;

interface OutboxAppendInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  partitionKey?: string;
  payload: Record<string, unknown>;
}

interface TransitionContext {
  reasonCode?: string;
  reasonMessage?: string;
  triggeredByType?: PaymentStateTriggerType;
  triggeredById?: string;
  correlationId: string;
  causationId?: string;
  payload?: Record<string, unknown>;
  outboxEvent?: OutboxAppendInput;
  expectedVersion?: number;
}

interface TransitionResult<TStatus extends TransitionTargetStatus> {
  entityId: string;
  previousStatus: TStatus;
  newStatus: TStatus;
}

@Injectable()
export class StateTransitionService {
  constructor(private readonly dbService: DbService<WalletSchema>) {}

  async transitionIntent(
    intentId: string,
    toStatus: PaymentIntentStatus,
    context: TransitionContext,
    fromStatus?: PaymentIntentStatus,
    tx?: DbTx,
  ): Promise<TransitionResult<PaymentIntentStatus>> {
    return inTx(this.dbService, async (trx) => {
      const row = await this.lockIntent(intentId, trx);
      if (!row) {
        throw new Error(`INTENT_NOT_FOUND: ${intentId}`);
      }

      if (fromStatus && row.status !== fromStatus) {
        throw this.buildStatusMismatchConflict(
          'INTENT',
          intentId,
          fromStatus,
          row.status,
        );
      }

      this.assertExpectedVersion('INTENT', intentId, context.expectedVersion, row.version);
      assertTransitionAllowed('INTENT', row.status, toStatus);

      await trx
        .update(paymentIntents)
        .set({
          status: toStatus,
          version: sql`${paymentIntents.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(paymentIntents.id, intentId));

      await this.appendTransition(
        'INTENT',
        intentId,
        row.status,
        toStatus,
        context,
        trx,
      );
      await this.appendOutboxIfNeeded(context, trx);

      return {
        entityId: intentId,
        previousStatus: row.status,
        newStatus: toStatus,
      };
    }, tx);
  }

  async transitionLeg(
    legId: string,
    toStatus: PaymentLegStatus,
    context: TransitionContext,
    fromStatus?: PaymentLegStatus,
    tx?: DbTx,
  ): Promise<TransitionResult<PaymentLegStatus>> {
    return inTx(this.dbService, async (trx) => {
      const row = await this.lockLeg(legId, trx);
      if (!row) {
        throw new Error(`LEG_NOT_FOUND: ${legId}`);
      }

      if (fromStatus && row.status !== fromStatus) {
        throw this.buildStatusMismatchConflict('LEG', legId, fromStatus, row.status);
      }

      this.assertExpectedVersion('LEG', legId, context.expectedVersion, row.version);
      assertTransitionAllowed('LEG', row.status, toStatus);

      await trx
        .update(paymentLegs)
        .set({
          status: toStatus,
          version: sql`${paymentLegs.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(paymentLegs.id, legId));

      await this.appendTransition('LEG', legId, row.status, toStatus, context, trx);
      await this.appendOutboxIfNeeded(context, trx);

      return {
        entityId: legId,
        previousStatus: row.status,
        newStatus: toStatus,
      };
    }, tx);
  }

  async transitionAttempt(
    attemptId: string,
    toStatus: PaymentAttemptStatus,
    context: TransitionContext,
    fromStatus?: PaymentAttemptStatus,
    tx?: DbTx,
  ): Promise<TransitionResult<PaymentAttemptStatus>> {
    return inTx(this.dbService, async (trx) => {
      const row = await this.lockAttempt(attemptId, trx);
      if (!row) {
        throw new Error(`ATTEMPT_NOT_FOUND: ${attemptId}`);
      }

      if (fromStatus && row.status !== fromStatus) {
        throw this.buildStatusMismatchConflict(
          'ATTEMPT',
          attemptId,
          fromStatus,
          row.status,
        );
      }

      assertTransitionAllowed('ATTEMPT', row.status, toStatus);

      await trx
        .update(paymentAttempts)
        .set({
          status: toStatus,
          updatedAt: new Date(),
        })
        .where(eq(paymentAttempts.id, attemptId));

      await this.appendTransition(
        'ATTEMPT',
        attemptId,
        row.status,
        toStatus,
        context,
        trx,
      );
      await this.appendOutboxIfNeeded(context, trx);

      return {
        entityId: attemptId,
        previousStatus: row.status,
        newStatus: toStatus,
      };
    }, tx);
  }

  async transitionRefundRequest(
    refundId: string,
    toStatus: RefundRequestStatus,
    context: TransitionContext,
    fromStatus?: RefundRequestStatus,
    tx?: DbTx,
  ): Promise<TransitionResult<RefundRequestStatus>> {
    return inTx(this.dbService, async (trx) => {
      const row = await this.lockRefundRequest(refundId, trx);
      if (!row) {
        throw new Error(`REFUND_REQUEST_NOT_FOUND: ${refundId}`);
      }

      if (fromStatus && row.status !== fromStatus) {
        throw this.buildStatusMismatchConflict(
          'REFUND_REQUEST',
          refundId,
          fromStatus,
          row.status,
        );
      }

      assertTransitionAllowed('REFUND_REQUEST', row.status, toStatus);

      await trx
        .update(refundRequests)
        .set({
          status: toStatus,
          updatedAt: new Date(),
        })
        .where(eq(refundRequests.id, refundId));

      await this.appendTransition(
        'REFUND_REQUEST',
        refundId,
        row.status,
        toStatus,
        context,
        trx,
      );
      await this.appendOutboxIfNeeded(context, trx);

      return {
        entityId: refundId,
        previousStatus: row.status,
        newStatus: toStatus,
      };
    }, tx);
  }

  async transitionManualCancelQueueItem(
    itemId: string,
    toStatus: ManualCancelQueueStatus,
    context: TransitionContext,
    fromStatus?: ManualCancelQueueStatus,
    tx?: DbTx,
  ): Promise<TransitionResult<ManualCancelQueueStatus>> {
    return inTx(this.dbService, async (trx) => {
      const row = await this.lockManualCancelQueueItem(itemId, trx);
      if (!row) {
        throw new Error(`MANUAL_CANCEL_QUEUE_ITEM_NOT_FOUND: ${itemId}`);
      }

      if (fromStatus && row.status !== fromStatus) {
        throw this.buildStatusMismatchConflict(
          'MANUAL_CANCEL_QUEUE_ITEM',
          itemId,
          fromStatus,
          row.status,
        );
      }

      assertTransitionAllowed('MANUAL_CANCEL_QUEUE_ITEM', row.status, toStatus);

      await trx
        .update(manualCancelQueueItems)
        .set({
          status: toStatus,
          updatedAt: new Date(),
        })
        .where(eq(manualCancelQueueItems.id, itemId));

      await this.appendTransition(
        'MANUAL_CANCEL_QUEUE_ITEM',
        itemId,
        row.status,
        toStatus,
        context,
        trx,
      );
      await this.appendOutboxIfNeeded(context, trx);

      return {
        entityId: itemId,
        previousStatus: row.status,
        newStatus: toStatus,
      };
    }, tx);
  }

  private async appendTransition(
    entityType: PaymentStateEntityType,
    entityId: string,
    previousStatus: string,
    newStatus: string,
    context: TransitionContext,
    tx: DbTx,
  ): Promise<void> {
    await tx.insert(paymentStateTransitions).values({
      entityType,
      entityId,
      previousStatus,
      newStatus,
      reasonCode: context.reasonCode,
      reasonMessage: context.reasonMessage,
      triggeredByType: context.triggeredByType ?? 'SYSTEM',
      triggeredById: context.triggeredById,
      correlationId: context.correlationId,
      causationId: context.causationId,
      occurredAt: new Date(),
      payload: context.payload,
    });
  }

  private async appendOutboxIfNeeded(
    context: TransitionContext,
    tx: DbTx,
  ): Promise<void> {
    if (!context.outboxEvent) {
      return;
    }

    const outboxEvent = context.outboxEvent;

    await tx.insert(outboxEvents).values({
      messageId: generateMessageId(),
      eventType: outboxEvent.eventType,
      aggregateType: outboxEvent.aggregateType,
      aggregateId: outboxEvent.aggregateId,
      partitionKey: outboxEvent.partitionKey ?? outboxEvent.aggregateId,
      payload: outboxEvent.payload,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  private async lockIntent(
    intentId: string,
    tx: DbTx,
  ): Promise<{ status: PaymentIntentStatus; version: number } | null> {
    const rows = (await tx.execute(sql`
      select status, version
      from payment_intents
      where id = ${intentId}
      for update
    `)) as Array<{ status: PaymentIntentStatus; version: number }>;

    return rows[0] ?? null;
  }

  private async lockLeg(
    legId: string,
    tx: DbTx,
  ): Promise<{ status: PaymentLegStatus; version: number } | null> {
    const rows = (await tx.execute(sql`
      select status, version
      from payment_legs
      where id = ${legId}
      for update
    `)) as Array<{ status: PaymentLegStatus; version: number }>;

    return rows[0] ?? null;
  }

  private async lockAttempt(
    attemptId: string,
    tx: DbTx,
  ): Promise<{ status: PaymentAttemptStatus } | null> {
    const rows = (await tx.execute(sql`
      select status
      from payment_attempts
      where id = ${attemptId}
      for update
    `)) as Array<{ status: PaymentAttemptStatus }>;

    return rows[0] ?? null;
  }

  private async lockRefundRequest(
    refundId: string,
    tx: DbTx,
  ): Promise<{ status: RefundRequestStatus } | null> {
    const rows = (await tx.execute(sql`
      select status
      from refund_requests
      where id = ${refundId}
      for update
    `)) as Array<{ status: RefundRequestStatus }>;

    return rows[0] ?? null;
  }

  private async lockManualCancelQueueItem(
    itemId: string,
    tx: DbTx,
  ): Promise<{ status: ManualCancelQueueStatus } | null> {
    const rows = (await tx.execute(sql`
      select status
      from manual_cancel_queue_items
      where id = ${itemId}
      for update
    `)) as Array<{ status: ManualCancelQueueStatus }>;

    return rows[0] ?? null;
  }

  private assertExpectedVersion(
    entityType: 'INTENT' | 'LEG',
    entityId: string,
    expectedVersion: number | undefined,
    actualVersion: number,
  ): void {
    if (expectedVersion === undefined) {
      return;
    }

    if (actualVersion !== expectedVersion) {
      throw new ConflictException({
        error: 'OPTIMISTIC_LOCK_CONFLICT',
        message: `${entityType} version mismatch: expected=${expectedVersion}, actual=${actualVersion}, id=${entityId}`,
      });
    }
  }

  private buildStatusMismatchConflict(
    entityType: PaymentStateEntityType,
    entityId: string,
    expectedStatus: string,
    actualStatus: string,
  ): ConflictException {
    return new ConflictException({
      error: 'STATE_STATUS_MISMATCH',
      message: `${entityType} status mismatch: expected=${expectedStatus}, actual=${actualStatus}, id=${entityId}`,
    });
  }
}
