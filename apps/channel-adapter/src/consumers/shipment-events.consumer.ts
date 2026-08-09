import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { DbService } from '@app/db';
import { EventEnvelope, EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { FULFILLMENT_V2_STREAM, SHIPMENT_STREAM } from '@packages/event-contracts/streams';
import { MessageEnvelope, EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';
import { inboxEvents } from '../schema';
import type { ChannelAdapterSchema } from '../types';

@Controller()
@UseInterceptors(EventTypeGuard)
export class ShipmentEventsConsumer {
  private readonly logger = new Logger(ShipmentEventsConsumer.name);

  constructor(private readonly dbService: DbService<ChannelAdapterSchema>) {}

  @On(SHIPMENT_STREAM, 'ShipmentShipped')
  async handleShipmentShipped(
    @EventPayload() payload: EventPayloadOf<typeof SHIPMENT_STREAM, 'ShipmentShipped'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof SHIPMENT_STREAM, 'ShipmentShipped'>,
  ): Promise<void> {
    const validated = SHIPMENT_STREAM.events.ShipmentShipped.schema!.parse(payload);
    await this.insertInbox(
      'ShipmentShipped',
      validated,
      validated.shipmentId,
      validated.dispatchAttemptId,
      validated.dispatchedAt,
      envelope,
    );
  }

  @On(SHIPMENT_STREAM, 'ShipmentDelivered')
  async handleShipmentDelivered(
    @EventPayload() payload: EventPayloadOf<typeof SHIPMENT_STREAM, 'ShipmentDelivered'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof SHIPMENT_STREAM, 'ShipmentDelivered'>,
  ): Promise<void> {
    const validated = SHIPMENT_STREAM.events.ShipmentDelivered.schema!.parse(payload);
    await this.insertInbox(
      'ShipmentDelivered',
      validated,
      validated.shipmentId,
      `${validated.dispatchAttemptId}:${validated.providerEventId}`,
      validated.deliveredAt,
      envelope,
    );
  }

  @On(SHIPMENT_STREAM, 'ShipmentDispatchRecalled')
  async handleShipmentDispatchRecalled(
    @EventPayload() payload: EventPayloadOf<typeof SHIPMENT_STREAM, 'ShipmentDispatchRecalled'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof SHIPMENT_STREAM, 'ShipmentDispatchRecalled'>,
  ): Promise<void> {
    const validated = SHIPMENT_STREAM.events.ShipmentDispatchRecalled.schema!.parse(payload);
    await this.insertInbox(
      'ShipmentDispatchRecalled',
      validated,
      validated.shipmentId,
      validated.recallOperationId,
      validated.recalledAt,
      envelope,
    );
  }

  @On(FULFILLMENT_V2_STREAM, 'FulfillmentProgressed')
  async handleFulfillmentProgressed(
    @EventPayload() payload: EventPayloadOf<typeof FULFILLMENT_V2_STREAM, 'FulfillmentProgressed'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof FULFILLMENT_V2_STREAM, 'FulfillmentProgressed'>,
  ): Promise<void> {
    const validated = FULFILLMENT_V2_STREAM.events.FulfillmentProgressed.schema!.parse(payload);
    await this.insertInbox(
      'FulfillmentProgressed',
      validated,
      validated.fulfillmentOrderId,
      `${validated.dispatchAttemptId}:${validated.fulfillmentOrderId}`,
      validated.progressedAt,
      envelope,
    );
  }

  @On(FULFILLMENT_V2_STREAM, 'FulfillmentReopened')
  async handleFulfillmentReopened(
    @EventPayload() payload: EventPayloadOf<typeof FULFILLMENT_V2_STREAM, 'FulfillmentReopened'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof FULFILLMENT_V2_STREAM, 'FulfillmentReopened'>,
  ): Promise<void> {
    const validated = FULFILLMENT_V2_STREAM.events.FulfillmentReopened.schema!.parse(payload);
    await this.insertInbox(
      'FulfillmentReopened',
      validated,
      validated.fulfillmentOrderId,
      `${validated.recallOperationId}:${validated.fulfillmentOrderId}`,
      validated.reopenedAt,
      envelope,
    );
  }

  private async insertInbox(
    eventType: string,
    payload: Record<string, unknown>,
    partitionKey: string,
    idempotencyKey: string,
    occurredAt: string,
    envelope: MessageEnvelope,
  ): Promise<void> {
    await this.dbService.db
      .insert(inboxEvents)
      .values({
        eventType,
        idempotencyKey,
        aggregateType: eventType.startsWith('Fulfillment') ? 'FulfillmentOrder' : 'Shipment',
        aggregateId: partitionKey,
        partitionKey,
        payload,
        metadata: {
          correlationId: envelope.correlationId,
          causationId: envelope.causationId,
          messageId: envelope.messageId,
        },
        status: 'pending',
        eventOccurredAt: new Date(occurredAt),
        createdAt: new Date(),
      })
      .onConflictDoNothing();

    this.logger.debug(`Durably accepted ${eventType}: ${idempotencyKey}`);
  }
}
