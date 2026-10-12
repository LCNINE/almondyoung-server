// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.ts
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import {
  ORDER_STREAM,
  channelOrderPartitionKey,
  type ChannelOrderSettlementFailedPayload,
} from '@packages/event-contracts/streams';
import { channelAdapterSchema, wmsOrderMappings } from '../../schema';

/** 멱등 키에 싣는 실패 코드의 상한 — 키 칸이 varchar(255)다. 넘치면 적재가 매번 실패해 명령이 DLQ 로 간다 */
const KEY_FAILURE_CODE_MAX = 120;

/** 채널 주문 취소 명령의 DB 쪽 — 수집 매핑 확인과 결과 사실의 아웃박스 적재 (#1016 35번 행 · 36번 재설계). */
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

  /**
   * 정산 실패 사실을 적재한다.
   *
   * 멱등 키에 deliveryId(명령 봉투 messageId)를 넣는다 — Kafka 가 같은 메시지를 다시 주면 한 번만 적재되고, core 의 재발행은 새 messageId 라
   * 사실을 다시 낸다(첫 사실이 유실됐어도 두 번째 시도가 빈손이 되지 않는다). failureCode 도 넣는다 — 같은 전달의 재배달 사이에 결과가 바뀌면 다른 사실이다.
   */
  async recordSettlementFailure(fact: ChannelOrderSettlementFailedPayload, deliveryId: string): Promise<void> {
    const code = fact.failureCode.slice(0, KEY_FAILURE_CODE_MAX);
    // enqueue 가 tx 를 필수로 받는다 — 사실이 하나라 묶을 것은 없지만 트랜잭션 하나로 적재한다
    await this.db.db.transaction(async (tx) =>
      this.orders.enqueue(
        {
          eventType: 'ChannelOrderSettlementFailed',
          aggregateId: channelOrderPartitionKey(fact.salesChannel, fact.externalOrderId),
          // 수집 사실(OrderCreated·OrderModified·OrderCancelled)과 같은 파티션 키 — 같은 파티션에 실린다(아웃박스를 거치므로 엄밀한 순서를 주장하진 않는다)
          partitionKey: fact.salesChannel,
          metadata: { partitionKey: fact.salesChannel },
          idempotencyKey: `settlement-failed:${fact.requestId}:${deliveryId}:${code}`,
          payload: fact,
        },
        tx,
      ),
    );
  }
}
