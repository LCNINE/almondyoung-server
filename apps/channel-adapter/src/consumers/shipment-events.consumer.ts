import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { DbService } from '@app/db';
import { EventEnvelope, EventPayload, OnEvent } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import {
  FULFILLMENT_V2_STREAM,
  FulfillmentProgressedPayload,
  FulfillmentReopenedPayload,
  SHIPMENT_STREAM,
  ShipmentDeliveredPayload,
  ShipmentDispatchRecalledPayload,
  ShipmentShippedPayload,
} from '@packages/event-contracts/streams';
import { MessageEnvelope } from '@packages/event-contracts/types';
import { inboxEvents } from '../schema';
import type { ChannelAdapterSchema } from '../types';

@Controller()
@UseInterceptors(EventTypeGuard)
export class ShipmentEventsConsumer {
  private readonly logger = new Logger(ShipmentEventsConsumer.name);

  constructor(private readonly dbService: DbService<ChannelAdapterSchema>) {}

  @OnEvent('shipments.events.v1', 'ShipmentShipped')
  async handleShipmentShipped(
    @EventPayload() payload: ShipmentShippedPayload,
    @EventEnvelope() envelope: MessageEnvelope<ShipmentShippedPayload>,
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

  @OnEvent('shipments.events.v1', 'ShipmentDelivered')
  async handleShipmentDelivered(
    @EventPayload() payload: ShipmentDeliveredPayload,
    @EventEnvelope() envelope: MessageEnvelope<ShipmentDeliveredPayload>,
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

  @OnEvent('shipments.events.v1', 'ShipmentDispatchRecalled')
  async handleShipmentDispatchRecalled(
    @EventPayload() payload: ShipmentDispatchRecalledPayload,
    @EventEnvelope() envelope: MessageEnvelope<ShipmentDispatchRecalledPayload>,
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

  @OnEvent('fulfillments.events.v2', 'FulfillmentProgressed')
  async handleFulfillmentProgressed(
    @EventPayload() payload: FulfillmentProgressedPayload,
    @EventEnvelope() envelope: MessageEnvelope<FulfillmentProgressedPayload>,
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

  @OnEvent('fulfillments.events.v2', 'FulfillmentReopened')
  async handleFulfillmentReopened(
    @EventPayload() payload: FulfillmentReopenedPayload,
    @EventEnvelope() envelope: MessageEnvelope<FulfillmentReopenedPayload>,
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
