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

  async recordRejected(payload: ChannelOrderCancelRejectedPayload, deliveryId: string): Promise<void> {
    await this.enqueueFact('ChannelOrderCancelRejected', `cancel-rejected:${payload.requestId}:${deliveryId}`, payload);
  }

  async recordStalled(payload: ChannelOrderCancelStalledPayload, deliveryId: string): Promise<void> {
    // 같은 전달의 재시도가 일시 실패 뒤 영구 거절을 만나면 사유가 바뀐다 — 키에 wallet 코드를 붙여야 그 사실이 버려지지 않는다.
    // 사유 없는 사실의 키는 그대로 둔다(배포 전후 아웃박스 행과 겹치지 않게)
    const suffix = payload.refundFailure ? `:${payload.refundFailure.walletCode}` : '';
    await this.enqueueFact(
      'ChannelOrderCancelStalled',
      `cancel-stalled:${payload.requestId}:${deliveryId}${suffix}`,
      payload,
    );
  }

  /**
   * 멱등 키에 deliveryId(명령 봉투 messageId)를 넣는다 — Kafka 가 같은 메시지를 다시 주면 messageId 가 같아 한 번만 적재되고,
   * core 의 «다시 보내기»는 새 messageId 라 사실을 다시 낸다(첫 사실이 유실됐어도 두 번째 시도가 빈손이 되지 않는다).
   * 따라서 core 는 같은 requestId 의 반복된 사실을 no-op 으로 다뤄야 한다.
   */
  private async enqueueFact(
    eventType: 'ChannelOrderCancelRejected' | 'ChannelOrderCancelStalled',
    idempotencyKey: string,
    payload: ChannelOrderCancelRejectedPayload | ChannelOrderCancelStalledPayload,
  ): Promise<void> {
    await this.db.db.transaction((tx) =>
      this.orders.enqueue(
        {
          eventType,
          aggregateId: channelOrderPartitionKey(payload.salesChannel, payload.externalOrderId),
          // 수집 사실(OrderCreated·OrderModified·OrderCancelled)과 같은 파티션 키 — 같은 파티션에 실린다(아웃박스를 거치므로 엄밀한 순서를 주장하진 않는다)
          partitionKey: payload.salesChannel,
          metadata: { partitionKey: payload.salesChannel },
          idempotencyKey,
          payload,
        },
        tx,
      ),
    );
  }
}
