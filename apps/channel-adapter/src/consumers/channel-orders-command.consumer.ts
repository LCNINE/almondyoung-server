import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventEnvelope, EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { CHANNEL_ORDERS_COMMAND_STREAM } from '@packages/event-contracts/streams';
import { EnvelopeOf, EventPayloadOf } from '@packages/event-contracts/types';
import { OrderPollerOrchestrator } from '../services/order-collection/order-poller.orchestrator';
import { isSyncableChannel } from '../services/order-collection/syncable-channels';

/**
 * `channel-orders.commands.v1` 소비자 (#1016 6번 행 스펙 §7.3).
 *
 * core 는 channel-adapter 를 직접 부르지 않는다 — 채널 쪽 일을 원하면 이 명령 스트림에 요청한다.
 * «다시 확인»은 5번 행의 즉시 끌어오기와 같은 메서드를 `force` 로 탄다. 결과는 `OrderModified` 로 돌아간다.
 *
 * 결과가 정해진 실패(미지원 채널·비활성·주문 없음 등)는 로그만 남기고 정상 종료한다 — 재시도해도 같다.
 * 예상 밖 예외(채널 API 5xx·네트워크)는 던져서 재시도·DLQ 를 탄다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class ChannelOrdersCommandConsumer {
  private readonly logger = new Logger(ChannelOrdersCommandConsumer.name);

  constructor(private readonly orderPoller: OrderPollerOrchestrator) {}

  @On(CHANNEL_ORDERS_COMMAND_STREAM, 'ResyncChannelOrder')
  async handleResync(
    @EventPayload() payload: EventPayloadOf<typeof CHANNEL_ORDERS_COMMAND_STREAM, 'ResyncChannelOrder'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof CHANNEL_ORDERS_COMMAND_STREAM, 'ResyncChannelOrder'>,
  ): Promise<void> {
    const { salesChannel, externalOrderId } = payload;
    if (!isSyncableChannel(salesChannel)) {
      this.logger.warn(`[RESYNC] 지원하지 않는 채널이라 건너뜀: ${salesChannel}:${externalOrderId}`, {
        correlationId: envelope.correlationId,
      });
      return;
    }
    const { outcome } = await this.orderPoller.syncOrder(salesChannel, externalOrderId, { force: true });
    this.logger.log(`[RESYNC] ${salesChannel}:${externalOrderId} → ${outcome}`, { correlationId: envelope.correlationId });
  }
}
