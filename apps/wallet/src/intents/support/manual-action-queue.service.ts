import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  ManualCancelQueueStatus,
  manualCancelQueueItems,
  paymentStateTransitions,
} from '../../schema';
import { DbTx } from '../../types';

export type ManualActionType = 'CANCEL' | 'REFUND' | 'MANUAL_CONFIRM';

export const OPEN_MANUAL_QUEUE_STATUSES: ManualCancelQueueStatus[] = [
  'QUEUED',
  'ASSIGNED',
  'PROCESSING',
  'FAILED_RETRYABLE',
];

@Injectable()
export class ManualActionQueueService {
  async upsertManualQueueItem(
    tx: DbTx,
    input: {
      intentId: string;
      legId: string;
      actionType: ManualActionType;
      reasonCode: string;
      reasonMessage: string;
      correlationId: string;
      triggeredById: string;
      creationReasonMessage: string;
    },
  ): Promise<string> {
    const existingOpenItems = await tx
      .select({
        id: manualCancelQueueItems.id,
      })
      .from(manualCancelQueueItems)
      .where(
        and(
          eq(manualCancelQueueItems.intentId, input.intentId),
          eq(manualCancelQueueItems.legId, input.legId),
          inArray(manualCancelQueueItems.status, OPEN_MANUAL_QUEUE_STATUSES),
        ),
      )
      .limit(1);

    const existing = existingOpenItems[0];
    if (existing) {
      await this.updateExistingQueueItem(tx, existing.id, input);
      return existing.id;
    }

    try {
      const insertedItems = await tx
        .insert(manualCancelQueueItems)
        .values({
          intentId: input.intentId,
          legId: input.legId,
          actionType: input.actionType,
          status: 'QUEUED',
          reasonCode: input.reasonCode,
          reasonMessage: input.reasonMessage,
          priority: 'normal',
          retryCount: 0,
          lastErrorCode: input.reasonCode,
          lastErrorMessage: input.reasonMessage,
        })
        .returning({
          id: manualCancelQueueItems.id,
        });

      const inserted = insertedItems[0];
      if (!inserted) {
        throw new Error('MANUAL_QUEUE_INSERT_FAILED');
      }

      await tx.insert(paymentStateTransitions).values({
        entityType: 'MANUAL_CANCEL_QUEUE_ITEM',
        entityId: inserted.id,
        previousStatus: null,
        newStatus: 'QUEUED',
        reasonCode: 'MANUAL_QUEUE_ITEM_CREATED',
        reasonMessage: input.creationReasonMessage,
        triggeredByType: 'SYSTEM',
        triggeredById: input.triggeredById,
        correlationId: input.correlationId,
        occurredAt: new Date(),
        payload: {
          intentId: input.intentId,
          legId: input.legId,
          actionType: input.actionType,
        },
      });

      return inserted.id;
    } catch (error) {
      if (!isOpenManualQueueUniqueViolation(error)) {
        throw error;
      }

      const conflictOpenItems = await tx
        .select({
          id: manualCancelQueueItems.id,
        })
        .from(manualCancelQueueItems)
        .where(
          and(
            eq(manualCancelQueueItems.intentId, input.intentId),
            eq(manualCancelQueueItems.legId, input.legId),
            inArray(manualCancelQueueItems.status, OPEN_MANUAL_QUEUE_STATUSES),
          ),
        )
        .limit(1);

      const conflictItem = conflictOpenItems[0];
      if (!conflictItem) {
        throw error;
      }

      await this.updateExistingQueueItem(tx, conflictItem.id, input);
      return conflictItem.id;
    }
  }

  private async updateExistingQueueItem(
    tx: DbTx,
    queueItemId: string,
    input: {
      actionType: ManualActionType;
      reasonCode: string;
      reasonMessage: string;
    },
  ): Promise<void> {
    await tx
      .update(manualCancelQueueItems)
      .set({
        actionType: input.actionType,
        reasonCode: input.reasonCode,
        reasonMessage: input.reasonMessage,
        lastErrorCode: input.reasonCode,
        lastErrorMessage: input.reasonMessage,
        retryCount: sql`${manualCancelQueueItems.retryCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(manualCancelQueueItems.id, queueItemId));
  }
}

function isOpenManualQueueUniqueViolation(error: unknown): boolean {
  const current = error as
    | {
        code?: string;
        constraint?: string;
        message?: string;
        cause?: unknown;
        originalError?: unknown;
      }
    | undefined;

  if (!current) {
    return false;
  }

  if (
    current.code === '23505' &&
    current.constraint === 'uq_manual_cancel_queue_open_intent_leg'
  ) {
    return true;
  }

  if ((current.message ?? '').includes('uq_manual_cancel_queue_open_intent_leg')) {
    return true;
  }

  if (current.cause) {
    return isOpenManualQueueUniqueViolation(current.cause);
  }

  if (current.originalError) {
    return isOpenManualQueueUniqueViolation(current.originalError);
  }

  return false;
}

