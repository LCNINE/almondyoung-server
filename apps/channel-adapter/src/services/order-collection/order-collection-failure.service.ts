import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { DbService } from '@app/db';
import { channelAdapterSchema, orderCollectionFailures } from '../../schema';
import { NewOrderCollectionFailure, OrderCollectionFailure, OrderCollectionFailureStatus } from '../../types';
import { OrderCollectionFailureItem, OrderCollectionFailureReason } from './channel-order-provider.interface';

type DbTx = Parameters<Parameters<DbService<typeof channelAdapterSchema>['db']['transaction']>[0]>[0];

@Injectable()
export class OrderCollectionFailureService {
  private readonly logger = new Logger(OrderCollectionFailureService.name);

  constructor(private readonly db: DbService<typeof channelAdapterSchema>) {}

  async recordFailure(
    channel: string,
    failure: OrderCollectionFailureItem,
    tx?: DbTx,
  ): Promise<OrderCollectionFailure> {
    const now = new Date();
    const values: NewOrderCollectionFailure = {
      channel,
      externalOrderId: failure.externalOrderId,
      reason: failure.reason,
      affectedLineIds: failure.affectedLineIds,
      rawOrder: failure.rawOrder,
      sourceUpdatedAt: parseTimestamp(failure.sourceUpdatedAt),
      status: 'quarantined',
      replayedAt: null,
      replayedWmsOrderId: null,
      errorMessage: null,
      updatedAt: now,
    };

    const exec = (trx: DbTx | DbService<typeof channelAdapterSchema>['db']) =>
      trx
        .insert(orderCollectionFailures)
        .values(values)
        .onConflictDoUpdate({
          target: [
            orderCollectionFailures.channel,
            orderCollectionFailures.externalOrderId,
            orderCollectionFailures.reason,
          ],
          set: {
            affectedLineIds: values.affectedLineIds,
            rawOrder: values.rawOrder,
            sourceUpdatedAt: values.sourceUpdatedAt,
            status: 'quarantined',
            replayedAt: null,
            replayedWmsOrderId: null,
            errorMessage: null,
            updatedAt: now,
          },
        })
        .returning();

    const [record] = await exec(tx ?? this.db.db);
    this.logger.warn(`Quarantined order collection failure: ${channel}/${failure.externalOrderId}`, {
      reason: failure.reason,
      affectedLineIds: failure.affectedLineIds,
    });
    return record;
  }

  async findById(id: string): Promise<OrderCollectionFailure | null> {
    const rows = await this.db.db
      .select()
      .from(orderCollectionFailures)
      .where(eq(orderCollectionFailures.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(options: {
    channel?: string;
    reason?: OrderCollectionFailureReason;
    status?: OrderCollectionFailureStatus;
    limit?: number;
    offset?: number;
  }): Promise<OrderCollectionFailure[]> {
    const conditions: SQL[] = [];
    if (options.channel) {
      conditions.push(eq(orderCollectionFailures.channel, options.channel));
    }
    if (options.reason) {
      conditions.push(eq(orderCollectionFailures.reason, options.reason));
    }
    if (options.status) {
      conditions.push(eq(orderCollectionFailures.status, options.status));
    }

    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);

    return await this.db.db
      .select()
      .from(orderCollectionFailures)
      .where(conditions.length > 0 ? and(...conditions) : sql`true`)
      .orderBy(desc(orderCollectionFailures.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async markReplayed(id: string, wmsOrderId?: string): Promise<void> {
    await this.db.db
      .update(orderCollectionFailures)
      .set({
        status: 'replayed',
        replayedAt: new Date(),
        replayedWmsOrderId: wmsOrderId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(orderCollectionFailures.id, id));
  }
}

function parseTimestamp(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
