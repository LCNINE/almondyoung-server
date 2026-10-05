import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { InjectPublisher, PublisherFor } from '@app/events';
import { ConflictError, NotFoundError } from '@app/shared';
import { CHANNEL_ORDERS_COMMAND_STREAM, channelOrderPartitionKey } from '@packages/event-contracts/streams';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';

type AmendmentRow = typeof wmsTables.salesOrderAmendments.$inferSelect;

/** 채널 행 metadata(5번 행 `recordChannelAmendment` 가 채움)의 채널 키. 비면 명령을 내지 않는다 — 빈 키는 엉뚱한 조회가 된다. */
export function channelKeyOf(metadata: unknown): { salesChannel: string; externalOrderId: string } {
  if (metadata !== null && typeof metadata === 'object' && 'salesChannel' in metadata && 'externalOrderId' in metadata) {
    const { salesChannel, externalOrderId } = metadata;
    if (typeof salesChannel === 'string' && salesChannel && typeof externalOrderId === 'string' && externalOrderId) {
      return { salesChannel, externalOrderId };
    }
  }
  throw new Error('Channel amendment has no channel key in metadata');
}

/**
 * «반영 대기 변경»(채널 amendment pending)을 닫는 두 조치 (#1016 6번 행 §5).
 * - 무시: 어긋난 채 둔다. 이 행의 pending 델타와 똑같은 차이는 다시 띄우지 않는다(§6, manager 가 판정)
 * - 다시 확인: 채널에서 그 주문을 다시 가져오라는 명령을 낸다. core 는 channel-adapter 를 직접 부르지 않는다(§3 D2).
 *   결과는 돌아오지 않는다 — 같아졌으면 다음 `OrderModified` 가 이 행을 superseded 로 바꾼다
 */
@Injectable()
export class ChannelAmendmentActionsService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    @InjectPublisher(CHANNEL_ORDERS_COMMAND_STREAM)
    private readonly commands: PublisherFor<typeof CHANNEL_ORDERS_COMMAND_STREAM>,
  ) {}

  async dismiss(id: string, input: { note?: string; operatorId?: string }, tx?: DbTx): Promise<{ id: string; status: 'dismissed' }> {
    return this.db.run(async (trx) => {
      await this.lockPendingChannel(id, trx);
      const now = new Date();
      await trx
        .update(wmsTables.salesOrderAmendments)
        .set({ status: 'dismissed', dismissedAt: now, dismissedBy: input.operatorId ?? null, dismissNote: input.note ?? null, updatedAt: now })
        .where(eq(wmsTables.salesOrderAmendments.id, id));
      return { id, status: 'dismissed' as const };
    }, tx);
  }

  async requestResync(id: string, tx?: DbTx): Promise<{ id: string; resyncRequestedAt: Date }> {
    return this.db.run(async (trx) => {
      const row = await this.lockPendingChannel(id, trx);
      const { salesChannel, externalOrderId } = channelKeyOf(row.metadata);
      const requestedAt = new Date();
      await trx
        .update(wmsTables.salesOrderAmendments)
        .set({ resyncRequestedAt: requestedAt, updatedAt: requestedAt })
        .where(eq(wmsTables.salesOrderAmendments.id, id));
      const key = channelOrderPartitionKey(salesChannel, externalOrderId);
      await this.commands.enqueue(
        {
          idempotencyKey: `resync:${id}:${requestedAt.getTime()}`,
          eventType: 'ResyncChannelOrder',
          aggregateId: key,
          partitionKey: key,
          payload: { salesChannel, externalOrderId, requestedAt: requestedAt.toISOString() },
        },
        trx,
      );
      return { id, resyncRequestedAt: requestedAt };
    }, tx);
  }

  private async lockPendingChannel(id: string, trx: DbTx): Promise<AmendmentRow> {
    const [row] = await trx
      .select()
      .from(wmsTables.salesOrderAmendments)
      .where(eq(wmsTables.salesOrderAmendments.id, id))
      .for('update');
    if (!row) throw new NotFoundError(`SalesOrderAmendment ${id} not found`);
    if (row.origin !== 'channel' || row.status !== 'pending') {
      throw new ConflictError(`SalesOrderAmendment ${id} is not a pending channel change (origin=${row.origin}, status=${row.status})`);
    }
    return row;
  }
}
