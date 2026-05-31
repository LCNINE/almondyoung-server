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

  /**
   * 채널 + externalOrderId 로 아직 열려 있는(quarantined) 격리 레코드를 찾는다.
   * 이전 poll 에서 격리된 주문이 이후 terminal lifecycle 로 바뀌었는지 판단할 때 사용.
   */
  async findOpenByExternalOrderId(channel: string, externalOrderId: string): Promise<OrderCollectionFailure | null> {
    const rows = await this.db.db
      .select()
      .from(orderCollectionFailures)
      .where(
        and(
          eq(orderCollectionFailures.channel, channel),
          eq(orderCollectionFailures.externalOrderId, externalOrderId),
          eq(orderCollectionFailures.status, 'quarantined'),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * 격리된 주문이 수집되기 전에 terminal lifecycle(취소/환불 → 수집 불가)에 도달했을 때 호출.
   * replay 로는 결코 수집될 수 없으므로 격리를 닫아 고아 상태로 남지 않게 한다.
   */
  async closeAsTerminalLifecycle(id: string, reason: string): Promise<void> {
    await this.db.db
      .update(orderCollectionFailures)
      .set({
        status: 'closed_lifecycle',
        errorMessage: reason,
        updatedAt: new Date(),
      })
      .where(eq(orderCollectionFailures.id, id));
  }
}

function parseTimestamp(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
