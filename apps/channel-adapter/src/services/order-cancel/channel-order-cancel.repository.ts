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
  type ChannelOrderSettlementFailedPayload,
} from '@packages/event-contracts/streams';
import { channelAdapterSchema, wmsOrderMappings } from '../../schema';

/**
 * 같은 결과를 옛 core(PR 5 전)가 읽는 말로 한 번 더 — 옛 core 는 `ChannelOrderSettlementFailed` 를 버린다(#1016 36번 재설계 PR 3 판정 1).
 * 오늘의 channel-adapter 가 그 응답에 내던 사실만 싣는다. 정리 PR(§9.2 의 6)에서 지운다.
 */
export type LegacyCancelFact =
  | { eventType: 'ChannelOrderCancelRejected'; payload: ChannelOrderCancelRejectedPayload }
  | { eventType: 'ChannelOrderCancelStalled'; payload: ChannelOrderCancelStalledPayload };

type CancelFactEventType = 'ChannelOrderSettlementFailed' | LegacyCancelFact['eventType'];
type CancelFactPayload = ChannelOrderSettlementFailedPayload | ChannelOrderCancelRejectedPayload | ChannelOrderCancelStalledPayload;

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
   * 정산 실패 사실과 (있으면) 옛 사실을 한 트랜잭션에 적재한다 — 하나만 나가는 일이 없다.
   *
   * 멱등 키에 deliveryId(명령 봉투 messageId)를 넣는다 — Kafka 가 같은 메시지를 다시 주면 한 번만 적재되고, core 의 재발행은 새 messageId 라
   * 사실을 다시 낸다(첫 사실이 유실됐어도 두 번째 시도가 빈손이 되지 않는다). 정산 실패 키엔 failureCode 도 넣는다 — 일시 실패는 던져
   * 같은 전달이 재시도되므로(판정 2) 그 사이 결과가 영구 거절로 바뀌면 다른 사실이어야 한다. 따라서 core 는 같은 requestId 의 반복된 사실을 받아야 한다.
   */
  async recordSettlementFailure(
    fact: ChannelOrderSettlementFailedPayload,
    deliveryId: string,
    legacy?: LegacyCancelFact,
  ): Promise<void> {
    await this.db.db.transaction(async (tx) => {
      // tx 타입은 추론에 맡긴다 — 아웃박스의 DbTx 는 `@app/events` 밖으로 export 되지 않는다(옛 코드도 같은 모양이었다)
      const put = (eventType: CancelFactEventType, idempotencyKey: string, payload: CancelFactPayload) =>
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
        );
      const code = fact.failureCode.slice(0, KEY_FAILURE_CODE_MAX);
      await put('ChannelOrderSettlementFailed', `settlement-failed:${fact.requestId}:${deliveryId}:${code}`, fact);
      if (legacy?.eventType === 'ChannelOrderCancelRejected') {
        await put(legacy.eventType, `cancel-rejected:${legacy.payload.requestId}:${deliveryId}`, legacy.payload);
      } else if (legacy?.eventType === 'ChannelOrderCancelStalled') {
        await put(legacy.eventType, `cancel-stalled:${legacy.payload.requestId}:${deliveryId}`, legacy.payload);
      }
    });
  }
}
