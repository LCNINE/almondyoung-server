import { ConflictException, Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, sql } from 'drizzle-orm';
import {
  WalletSchema,
  charges,
  outboxEvents,
  paymentIntents,
  paymentStateTransitions,
  refunds,
  ChargeStatus,
  PaymentIntentStatus,
  PaymentStateEntityType,
  PaymentStateTriggerType,
  RefundStatus,
} from '../../schema';
import { DbTx } from '../../types';
import { inTx } from '../../database/tx.util';
import { assertTransitionAllowed } from './state-transition.rules';
import { buildOutboxInsertValues } from '../../messaging/outbox-event.util';

type TransitionTargetStatus = PaymentIntentStatus | ChargeStatus | RefundStatus;

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
        throw this.buildStatusMismatchConflict('INTENT', intentId, fromStatus, row.status);
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

      await this.appendTransition('INTENT', intentId, row.status, toStatus, context, trx);
      await this.appendOutboxIfNeeded(context, trx);

      return { entityId: intentId, previousStatus: row.status, newStatus: toStatus };
    }, tx);
  }

  async transitionCharge(
    chargeId: string,
    toStatus: ChargeStatus,
    context: TransitionContext,
    fromStatus?: ChargeStatus,
    tx?: DbTx,
  ): Promise<TransitionResult<ChargeStatus>> {
    return inTx(this.dbService, async (trx) => {
      const row = await this.lockCharge(chargeId, trx);
      if (!row) {
        throw new Error(`CHARGE_NOT_FOUND: ${chargeId}`);
      }

      if (fromStatus && row.status !== fromStatus) {
        throw this.buildStatusMismatchConflict('CHARGE', chargeId, fromStatus, row.status);
      }

      assertTransitionAllowed('CHARGE', row.status, toStatus);

      await trx
        .update(charges)
        .set({
          status: toStatus,
          updatedAt: new Date(),
        })
        .where(eq(charges.id, chargeId));

      await this.appendTransition('CHARGE', chargeId, row.status, toStatus, context, trx);
      await this.appendOutboxIfNeeded(context, trx);

      return { entityId: chargeId, previousStatus: row.status, newStatus: toStatus };
    }, tx);
  }

  async transitionRefund(
    refundId: string,
    toStatus: RefundStatus,
    context: TransitionContext,
    fromStatus?: RefundStatus,
    tx?: DbTx,
  ): Promise<TransitionResult<RefundStatus>> {
    return inTx(this.dbService, async (trx) => {
      const row = await this.lockRefund(refundId, trx);
      if (!row) {
        throw new Error(`REFUND_NOT_FOUND: ${refundId}`);
      }

      if (fromStatus && row.status !== fromStatus) {
        throw this.buildStatusMismatchConflict('REFUND', refundId, fromStatus, row.status);
      }

      assertTransitionAllowed('REFUND', row.status, toStatus);

      await trx
        .update(refunds)
        .set({
          status: toStatus,
          updatedAt: new Date(),
        })
        .where(eq(refunds.id, refundId));

      await this.appendTransition('REFUND', refundId, row.status, toStatus, context, trx);
      await this.appendOutboxIfNeeded(context, trx);

      return { entityId: refundId, previousStatus: row.status, newStatus: toStatus };
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
      payload: context.payload ?? null,
    });
  }

  private async appendOutboxIfNeeded(context: TransitionContext, tx: DbTx): Promise<void> {
    if (!context.outboxEvent) {
      return;
    }
    await tx.insert(outboxEvents).values(buildOutboxInsertValues(context.outboxEvent));
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

  private async lockCharge(
    chargeId: string,
    tx: DbTx,
  ): Promise<{ status: ChargeStatus } | null> {
    const rows = (await tx.execute(sql`
      select status
      from charges
      where id = ${chargeId}
      for update
    `)) as Array<{ status: ChargeStatus }>;
    return rows[0] ?? null;
  }

  private async lockRefund(
    refundId: string,
    tx: DbTx,
  ): Promise<{ status: RefundStatus } | null> {
    const rows = (await tx.execute(sql`
      select status
      from refunds
      where id = ${refundId}
      for update
    `)) as Array<{ status: RefundStatus }>;
    return rows[0] ?? null;
  }

  private assertExpectedVersion(
    entityType: 'INTENT',
    entityId: string,
    expectedVersion: number | undefined,
    actualVersion: number,
  ): void {
    if (expectedVersion === undefined) return;

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
