import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventEnvelope, EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { CHANNEL_ORDERS_COMMAND_STREAM } from '@packages/event-contracts/streams';
import { EnvelopeOf, EventPayloadOf } from '@packages/event-contracts/types';
import { OrderPollerOrchestrator } from '../services/order-collection/order-poller.orchestrator';
import { isSyncableChannel } from '../services/order-collection/syncable-channels';
import { ChannelReturnSettleManager } from '../services/order-cancel/channel-return-settle.manager';
import { ChannelReturnPrepayManager } from '../services/order-cancel/channel-return-prepay.manager';
import { ChannelOrderCancelManager } from '../services/order-cancel/channel-order-cancel.manager';

/**
 * `channel-orders.commands.v1` 소비자 (#1016 6번 행 스펙 §7.3).
 *
 * core 는 channel-adapter 를 직접 부르지 않는다 — 채널 쪽 일을 원하면 이 명령 스트림에 요청한다.
 * «다시 확인»은 5번 행의 즉시 끌어오기와 같은 메서드를 `force` 로 탄다. 결과는 `OrderModified` 로 돌아간다.
 * «취소»(35번 행)는 `ChannelOrderCancelManager` 가 채널 정산 라우트에 실행하고, 결과는 재수집 또는 `ChannelOrderSettlementFailed` 로 돌아간다(#1016 36번 재설계).
 *
 * «반품 정산»(K8 PR6)은 `ChannelReturnSettleManager` 가 같은 길을 탄다 — 실패는 `ChannelReturnSettlementFailed`, 성공은 재수집이 낸 `ChannelReturnSettled`.
 *
 * «반품 선환불»(K8 PR6b)은 `ChannelReturnPrepayManager` 가 같은 길을 탄다 — 실패는 `ChannelReturnPrepayFailed`, 성공은 재수집이 낸 `ChannelReturnPrepaid`.
 *
 * 다시 확인의 정해진 실패(미지원 채널 등)는 로그만 남기고 정상 종료한다. 취소의 정산 실패는 영구든 일시든 사실을 낸 뒤 정상 종료하고
 * (일시 실패는 core 리컨실러가 다시 부른다), 사실을 못 낸 경우·예상 밖 예외는 던져서 재시도·DLQ 를 탄다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class ChannelOrdersCommandConsumer {
  private readonly logger = new Logger(ChannelOrdersCommandConsumer.name);

  constructor(
    private readonly orderPoller: OrderPollerOrchestrator,
    private readonly cancelManager: ChannelOrderCancelManager,
    private readonly returnSettleManager: ChannelReturnSettleManager,
    private readonly returnPrepayManager: ChannelReturnPrepayManager,
  ) {}

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
    this.logger.log(`[RESYNC] ${salesChannel}:${externalOrderId} → ${outcome}`, {
      correlationId: envelope.correlationId,
    });
  }

  @On(CHANNEL_ORDERS_COMMAND_STREAM, 'CancelChannelOrder')
  async handleCancel(
    @EventPayload() payload: EventPayloadOf<typeof CHANNEL_ORDERS_COMMAND_STREAM, 'CancelChannelOrder'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof CHANNEL_ORDERS_COMMAND_STREAM, 'CancelChannelOrder'>,
  ): Promise<void> {
    this.logger.log(
      `[CANCEL] ${payload.requestId} ${payload.salesChannel}:${payload.externalOrderId} ${payload.scope} 수신`,
      {
        correlationId: envelope.correlationId,
      },
    );
    await this.cancelManager.execute(payload, envelope.messageId);
  }

  @On(CHANNEL_ORDERS_COMMAND_STREAM, 'SettleChannelReturn')
  async handleSettleReturn(
    @EventPayload() payload: EventPayloadOf<typeof CHANNEL_ORDERS_COMMAND_STREAM, 'SettleChannelReturn'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof CHANNEL_ORDERS_COMMAND_STREAM, 'SettleChannelReturn'>,
  ): Promise<void> {
    this.logger.log(
      `[RETURN-SETTLE] ${payload.requestId} ${payload.salesChannel}:${payload.externalOrderId} ${payload.returnId} 수신`,
      { correlationId: envelope.correlationId },
    );
    await this.returnSettleManager.execute(payload, envelope.messageId);
  }

  @On(CHANNEL_ORDERS_COMMAND_STREAM, 'PrepayChannelReturn')
  async handlePrepayReturn(
    @EventPayload() payload: EventPayloadOf<typeof CHANNEL_ORDERS_COMMAND_STREAM, 'PrepayChannelReturn'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof CHANNEL_ORDERS_COMMAND_STREAM, 'PrepayChannelReturn'>,
  ): Promise<void> {
    this.logger.log(
      `[RETURN-PREPAY] ${payload.requestId} ${payload.salesChannel}:${payload.externalOrderId} ${payload.returnId} 수신`,
      { correlationId: envelope.correlationId },
    );
    await this.returnPrepayManager.execute(payload, envelope.messageId);
  }
}
