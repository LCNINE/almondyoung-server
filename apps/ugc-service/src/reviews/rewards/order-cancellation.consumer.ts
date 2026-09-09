import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventEnvelope, EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import { EnvelopeOf, EventPayloadOf } from '@packages/event-contracts/types';
import { ReviewRewardManager } from './review-reward.manager';

/**
 * ugc 의 첫 이벤트 컨슈머. 주문이 취소되면 리뷰 자격과 이미 나간 적립을 되돌린다.
 *
 * **왜 `SalesOrderCancelled` 하나인가**(2026-09-08 실측, §13-1): `FulfillmentCancelled`·
 * `FulfillmentReturned` 는 저장소 어디에서도 발행되지 않고, 인바운드 `OrderCancelled` 는 core 가
 * 받아 자기 취소를 부르므로 이 이벤트로 수렴한다. 관리자 취소·고객 취소요청·인텐트 취소가
 * 전부 여기로 온다.
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
}
