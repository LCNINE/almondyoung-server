import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventEnvelope, EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import { EnvelopeOf, EventPayloadOf } from '@packages/event-contracts/types';
import { ReviewRewardManager } from './review-reward.manager';

/**
 * ugc 의 이벤트 컨슈머. 주문이 취소되거나 반품이 완료되면 리뷰 자격과 이미 나간 적립을 되돌린다.
 *
 * **왜 `SalesOrderCancelled` 하나인가**(2026-09-08 실측, §13-1): `FulfillmentCancelled`·
 * `FulfillmentReturned` 는 저장소 어디에서도 발행되지 않고, 인바운드 `OrderCancelled` 는 core 가
 * 받아 자기 취소를 부르므로 이 이벤트로 수렴한다. 관리자 취소·고객 취소요청·인텐트 취소가
 * 전부 여기로 온다.
 *
 * **반품은 이벤트 자체가 없었다** — core 의 반품 완료 종점 3곳이 아웃박스에 아무것도 넣지 않아
 * 「사서 → 리뷰 → 적립 → 반품」이 그대로 통했다. `SalesOrderReturned` 는 그 구멍을 막으려고
 * 새로 만든 이벤트다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class OrderCancellationConsumer {
  private readonly logger = new Logger(OrderCancellationConsumer.name);

  constructor(private readonly manager: ReviewRewardManager) {}

  @On(CORE_ORDER_STREAM, 'SalesOrderCancelled')
  async onSalesOrderCancelled(
    @EventPayload() payload: EventPayloadOf<typeof CORE_ORDER_STREAM, 'SalesOrderCancelled'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof CORE_ORDER_STREAM, 'SalesOrderCancelled'>,
  ): Promise<void> {
    this.logger.log(
      `SalesOrderCancelled received: orderId=${payload.orderId}, channelOrderId=${payload.channelOrderId ?? '-'}, scope=${payload.cancellationScope}`,
      { correlationId: envelope.correlationId },
    );

    await this.manager.revokeForCancelledOrder({
      channelOrderId: payload.channelOrderId,
      cancellationScope: payload.cancellationScope,
      reason: payload.reason,
    });
  }

  @On(CORE_ORDER_STREAM, 'SalesOrderReturned')
  async onSalesOrderReturned(
    @EventPayload() payload: EventPayloadOf<typeof CORE_ORDER_STREAM, 'SalesOrderReturned'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof CORE_ORDER_STREAM, 'SalesOrderReturned'>,
  ): Promise<void> {
    this.logger.log(
      `SalesOrderReturned received: orderId=${payload.orderId}, channelOrderId=${payload.channelOrderId ?? '-'}, ` +
        `returnRequestId=${payload.returnRequestId}, lines=${payload.returnedLines.length}`,
      { correlationId: envelope.correlationId },
    );

    await this.manager.revokeForReturnedOrder({
      channelOrderId: payload.channelOrderId,
      reason: payload.reason,
      returnedLines: payload.returnedLines,
    });
  }
}
