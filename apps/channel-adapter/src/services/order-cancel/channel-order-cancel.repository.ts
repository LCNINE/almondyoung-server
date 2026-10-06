// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.ts
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import {
  ORDER_STREAM,
  channelOrderPartitionKey,
  type ChannelOrderCancelRejectedPayload,
  type ChannelOrderCancelStalledPayload,
} from '@packages/event-contracts/streams';
import { channelAdapterSchema, wmsOrderMappings } from '../../schema';

/** 채널 주문 취소 명령의 DB 쪽 — 수집 매핑 확인과 결과 사실의 아웃박스 적재 (#1016 35번 행). */
@Injectable()
export class ChannelOrderCancelRepository {
  constructor(
    private readonly db: DbService<typeof channelAdapterSchema>,
    @InjectPublisher(ORDER_STREAM)
    private readonly orders: PublisherFor<typeof ORDER_STREAM>,
  ) {}

  /** 우리가 수집한 주문인가. 수집하지 않은 주문 id 로 채널을 건드리지 않는다. */
  async hasCollectedOrder(salesChannel: string, externalOrderId: string): Promise<boolean> {
    const [row] = await this.db.db
      .select({ id: wmsOrderMappings.id })
      .from(wmsOrderMappings)
      .where(and(eq(wmsOrderMappings.salesChannel, salesChannel), eq(wmsOrderMappings.channelOrderId, externalOrderId)))
      .limit(1);
    return row !== undefined;
  }

  async recordRejected(payload: ChannelOrderCancelRejectedPayload): Promise<void> {
    await this.db.db.transaction((tx) =>
      this.orders.enqueue(
        {
          eventType: 'ChannelOrderCancelRejected',
          aggregateId: channelOrderPartitionKey(payload.salesChannel, payload.externalOrderId),
          // 수집 사실(OrderCreated·OrderModified·OrderCancelled)과 같은 키 — 같은 채널 안에서 순서가 유지된다
          partitionKey: payload.salesChannel,
          metadata: { partitionKey: payload.salesChannel },
          // 같은 명령이 두 번 와도(최소 1회 전달) 사실은 한 번
          idempotencyKey: `cancel-rejected:${payload.requestId}`,
          payload,
        },
        tx,
      ),
    );
  }

  async recordStalled(payload: ChannelOrderCancelStalledPayload): Promise<void> {
    await this.db.db.transaction((tx) =>
      this.orders.enqueue(
        {
          eventType: 'ChannelOrderCancelStalled',
          aggregateId: channelOrderPartitionKey(payload.salesChannel, payload.externalOrderId),
          partitionKey: payload.salesChannel,
          metadata: { partitionKey: payload.salesChannel },
          // 재시도마다 다시 오지만 core 에겐 같은 값(stage=edited)이다
          idempotencyKey: `cancel-stalled:${payload.requestId}`,
          payload,
        },
        tx,
      ),
    );
  }
}
