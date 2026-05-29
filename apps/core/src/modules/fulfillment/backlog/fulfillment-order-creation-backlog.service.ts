import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { DbTx, FulfillmentOrderCreationBacklog, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { and, eq, inArray, sql } from 'drizzle-orm';

export type FulfillmentCreationMissingLine = {
  salesOrderLineId: string;
  variantId: string;
  reason: string;
};

const OPEN_BACKLOG_STATUSES = ['pending', 'failed', 'processing', 'awaiting_matching'] as const;

@Injectable()
export class FulfillmentOrderCreationBacklogService {
  private readonly logger = new Logger(FulfillmentOrderCreationBacklogService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async enqueueForSalesOrder(salesOrderId: string, tx?: DbTx): Promise<FulfillmentOrderCreationBacklog | undefined> {
    return this.inTx(async (trx) => {
      const [inserted] = await trx
        .insert(wmsTables.fulfillmentOrderCreationBacklogs)
        .values({
          salesOrderId,
          status: 'pending',
          waitingVariantIds: [],
          failureReason: null,
          failureDetails: null,
          nextAttemptAt: new Date(),
        })
        .onConflictDoNothing({ target: wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId })
        .returning();

      if (inserted) {
        return inserted;
      }

      return trx.query.fulfillmentOrderCreationBacklogs.findFirst({
        where: eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, salesOrderId),
      });
    }, tx);
  }

  async findById(id: string, tx?: DbTx): Promise<FulfillmentOrderCreationBacklog | undefined> {
    return this.inTx(
      (trx) =>
        trx.query.fulfillmentOrderCreationBacklogs.findFirst({
          where: eq(wmsTables.fulfillmentOrderCreationBacklogs.id, id),
        }),
      tx,
    );
  }

  async claimPending(limit = 20): Promise<FulfillmentOrderCreationBacklog[]> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`
        SELECT id
        FROM ${wmsTables.fulfillmentOrderCreationBacklogs}
        WHERE (
          status IN ('pending', 'failed')
          AND next_attempt_at <= NOW()
        )
        OR (
          status = 'processing'
          AND locked_at < NOW() - INTERVAL '5 minutes'
        )
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `);

      const ids = rows.map((row) => row.id);
      if (ids.length === 0) {
        return [];
      }

      return tx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({
          status: 'processing',
          attempts: sql`${wmsTables.fulfillmentOrderCreationBacklogs.attempts} + 1`,
          lockedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(wmsTables.fulfillmentOrderCreationBacklogs.id, ids))
        .returning();
    });
  }

  async markCompleted(backlogId: string, fulfillmentOrderId: string, tx?: DbTx) {
    return this.updateTerminal(backlogId, 'completed', fulfillmentOrderId, tx);
  }

  async markNotRequired(backlogId: string, tx?: DbTx) {
    return this.updateTerminal(backlogId, 'not_required', null, tx);
  }

  async markAwaitingMatching(backlogId: string, missingLines: FulfillmentCreationMissingLine[], tx?: DbTx) {
    const waitingVariantIds = [...new Set(missingLines.map((line) => line.variantId))];

    return this.inTx(
      (trx) =>
        trx
          .update(wmsTables.fulfillmentOrderCreationBacklogs)
          .set({
            status: 'awaiting_matching',
            waitingVariantIds,
            failureReason: 'PRODUCT_SKU_MATCHING_REQUIRED',
            failureDetails: { missingLines },
            lockedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(wmsTables.fulfillmentOrderCreationBacklogs.id, backlogId),
              eq(wmsTables.fulfillmentOrderCreationBacklogs.status, 'processing'),
            ),
          )
          .returning(),
      tx,
    );
  }

  async markFailed(backlogId: string, attempts: number, error: unknown, tx?: DbTx) {
    const nextAttemptAt = this.calculateNextAttempt(attempts);
    const details = this.serializeError(error);

    return this.inTx(
      (trx) =>
        trx
          .update(wmsTables.fulfillmentOrderCreationBacklogs)
          .set({
            status: 'failed',
            waitingVariantIds: [],
            failureReason: details.name,
            failureDetails: details,
            nextAttemptAt,
            lockedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(wmsTables.fulfillmentOrderCreationBacklogs.id, backlogId),
              eq(wmsTables.fulfillmentOrderCreationBacklogs.status, 'processing'),
            ),
          )
          .returning(),
      tx,
    );
  }

  async closeOpenForSalesOrder(salesOrderId: string, tx?: DbTx): Promise<number> {
    return this.inTx(async (trx) => {
      const updated = await trx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({
          status: 'not_required',
          waitingVariantIds: [],
          failureReason: null,
          failureDetails: null,
          lockedAt: null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, salesOrderId),
            inArray(wmsTables.fulfillmentOrderCreationBacklogs.status, [...OPEN_BACKLOG_STATUSES]),
          ),
        )
        .returning({ id: wmsTables.fulfillmentOrderCreationBacklogs.id });

      if (updated.length > 0) {
        this.logger.log(`Closed ${updated.length} fulfillment creation backlog(s) for cancelled order ${salesOrderId}`);
      }

      return updated.length;
    }, tx);
  }

  async wakeBacklogsWaitingForVariant(variantId: string, tx?: DbTx): Promise<number> {
    return this.inTx(async (trx) => {
      const updated = await trx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({
          status: 'pending',
          waitingVariantIds: [],
          failureReason: null,
          failureDetails: null,
          nextAttemptAt: new Date(),
          lockedAt: null,
          updatedAt: new Date(),
        })
        .where(
          sql`
          (
            ${wmsTables.fulfillmentOrderCreationBacklogs.status} = 'awaiting_matching'
            AND ${wmsTables.fulfillmentOrderCreationBacklogs.waitingVariantIds} ? ${variantId}
          )
          OR (
            ${wmsTables.fulfillmentOrderCreationBacklogs.status} = 'processing'
            AND EXISTS (
              SELECT 1
              FROM ${wmsTables.salesOrderLines}
              WHERE ${wmsTables.salesOrderLines.salesOrderId} =
                ${wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId}
              AND ${wmsTables.salesOrderLines.variantId} = ${variantId}
            )
          )
        `,
        )
        .returning({ id: wmsTables.fulfillmentOrderCreationBacklogs.id });

      if (updated.length > 0) {
        this.logger.log(`Requeued ${updated.length} fulfillment creation backlog(s) for variant ${variantId}`);
      }

      return updated.length;
    }, tx);
  }

  private async updateTerminal(
    backlogId: string,
    status: 'completed' | 'not_required',
    fulfillmentOrderId: string | null,
    tx?: DbTx,
  ) {
    return this.inTx(
      (trx) =>
        trx
          .update(wmsTables.fulfillmentOrderCreationBacklogs)
          .set({
            status,
            fulfillmentOrderId,
            waitingVariantIds: [],
            failureReason: null,
            failureDetails: null,
            lockedAt: null,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(wmsTables.fulfillmentOrderCreationBacklogs.id, backlogId),
              eq(wmsTables.fulfillmentOrderCreationBacklogs.status, 'processing'),
            ),
          )
          .returning(),
      tx,
    );
  }

  private calculateNextAttempt(attempts: number): Date {
    const delays = [10, 30, 60, 300, 900];
    const delaySeconds = delays[Math.min(Math.max(attempts - 1, 0), delays.length - 1)];
    return new Date(Date.now() + delaySeconds * 1000);
  }

  private serializeError(error: unknown) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return {
      name: 'Error',
      message: String(error),
    };
  }
}
