import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { DbService } from '@app/db';
import { EventEnvelope, EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { CORE_ORDER_STREAM } from '@packages/event-contracts/streams/orders.stream';
import { EnvelopeOf, EventPayloadOf } from '@packages/event-contracts/types';
import { inboxEvents } from '../schema';
import type { ChannelAdapterSchema } from '../types';

export const LINE_RESERVATION_STATE_EVENT_TYPE = 'SalesOrderLineReservationState';

/**
 * core 가 낸 판매주문 줄 예약 상태를 inbox 에 쌓기만 한다(#1247). Medusa 쓰기는
 * `ReservationProjectionWorker` 가 한다 — 소비 경로에 120초짜리 HTTP 를 두지 않는다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class LineReservationStateConsumer {
  private readonly logger = new Logger(LineReservationStateConsumer.name);

  constructor(private readonly dbService: DbService<ChannelAdapterSchema>) {}

  @On(CORE_ORDER_STREAM, 'SalesOrderLineReservationState')
  async onLineReservationState(
    @EventPayload() payload: EventPayloadOf<typeof CORE_ORDER_STREAM, 'SalesOrderLineReservationState'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof CORE_ORDER_STREAM, 'SalesOrderLineReservationState'>,
  ): Promise<void> {
    const idempotencyKey = `${payload.salesOrderId}:${payload.version}`;
    await this.dbService.db
      .insert(inboxEvents)
      .values({
        eventType: LINE_RESERVATION_STATE_EVENT_TYPE,
        idempotencyKey,
        aggregateType: 'Order',
        aggregateId: payload.salesOrderId,
        partitionKey: payload.salesOrderId,
        payload,
        metadata: {
          correlationId: envelope.correlationId,
          causationId: envelope.causationId,
          messageId: envelope.messageId,
        },
        status: 'pending',
        eventOccurredAt: new Date(payload.asOf),
        createdAt: new Date(),
      })
      .onConflictDoNothing();
    this.logger.debug(`Accepted ${LINE_RESERVATION_STATE_EVENT_TYPE}: ${idempotencyKey}`);
  }
}
