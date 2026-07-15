import {
  createFulfillmentShippedV1Projection,
  FULFILLMENT_STREAM,
  FULFILLMENT_V2_STREAM,
  FulfillmentProgressedPayload,
  FulfillmentShippedPayload,
  FulfillmentV1CompletionSummary,
  SHIPMENT_STREAM,
  ShipmentShippedPayload,
} from '@packages/event-contracts/streams';

export const ORDER_EVENTS = {
  CREATED: 'ORDER_CREATED',
  CONFIRMED: 'ORDER_CONFIRMED',
  MODIFIED: 'ORDER_MODIFIED',
  CANCELLED: 'ORDER_CANCELLED',
} as const;

export const FULFILLMENT_EVENTS = {
  CREATED: 'FulfillmentCreated',
  READY: 'FulfillmentReady',
  LABELLED: 'FulfillmentLabeled',
  SHIPPED: 'FulfillmentShipped',
  DELIVERED: 'FulfillmentDelivered',
  CANCELLED: 'FulfillmentCancelled',
} as const;

export const SHIPMENT_EVENTS = {
  SHIPPED: 'ShipmentShipped',
  DELIVERED: 'ShipmentDelivered',
  DISPATCH_RECALLED: 'ShipmentDispatchRecalled',
} as const;

export const FULFILLMENT_V2_EVENTS = {
  PROGRESSED: 'FulfillmentProgressed',
  REOPENED: 'FulfillmentReopened',
} as const;

export type OrderEvent = (typeof ORDER_EVENTS)[keyof typeof ORDER_EVENTS];
export type FulfillmentEvent = (typeof FULFILLMENT_EVENTS)[keyof typeof FULFILLMENT_EVENTS];
export type ShipmentEvent = (typeof SHIPMENT_EVENTS)[keyof typeof SHIPMENT_EVENTS];
export type FulfillmentV2Event = (typeof FULFILLMENT_V2_EVENTS)[keyof typeof FULFILLMENT_V2_EVENTS];

export interface FulfillmentOutboxEvent<TPayload> {
  topic: string;
  eventType: string;
  aggregateType: 'Shipment' | 'FulfillmentOrder' | 'Fulfillment';
  aggregateId: string;
  partitionKey: string;
  idempotencyKey: string;
  payload: TPayload;
}

/**
 * Build the attempt-owned shipment event. Parsing here keeps invalid/PII-enriched
 * payloads out of the durable outbox rather than failing later in the dispatcher.
 */
export function shipmentShippedOutboxEvent(
  payload: ShipmentShippedPayload,
): FulfillmentOutboxEvent<ShipmentShippedPayload> {
  const validPayload = SHIPMENT_STREAM.events.ShipmentShipped.schema!.parse(payload);
  return {
    topic: SHIPMENT_STREAM.topic.topic,
    eventType: SHIPMENT_EVENTS.SHIPPED,
    aggregateType: 'Shipment',
    aggregateId: validPayload.shipmentId,
    partitionKey: validPayload.shipmentId,
    idempotencyKey: validPayload.dispatchAttemptId,
    payload: validPayload,
  };
}

/** One progress fact per dispatch attempt and affected fulfillment order. */
export function fulfillmentProgressedOutboxEvent(
  payload: FulfillmentProgressedPayload,
): FulfillmentOutboxEvent<FulfillmentProgressedPayload> {
  const validPayload = FULFILLMENT_V2_STREAM.events.FulfillmentProgressed.schema!.parse(payload);
  return {
    topic: FULFILLMENT_V2_STREAM.topic.topic,
    eventType: FULFILLMENT_V2_EVENTS.PROGRESSED,
    aggregateType: 'FulfillmentOrder',
    aggregateId: validPayload.fulfillmentOrderId,
    partitionKey: validPayload.fulfillmentOrderId,
    idempotencyKey: `${validPayload.dispatchAttemptId}:${validPayload.fulfillmentOrderId}`,
    payload: validPayload,
  };
}

/**
 * The legacy event is a once-only full-completion projection, never a partial
 * shipment signal. Its stable key remains independent of a particular attempt.
 */
export function fulfillmentShippedV1OutboxEvent(
  payload: FulfillmentShippedPayload,
  completion: FulfillmentV1CompletionSummary,
): FulfillmentOutboxEvent<FulfillmentShippedPayload> {
  const validPayload = createFulfillmentShippedV1Projection(payload, completion);
  return {
    topic: FULFILLMENT_STREAM.topic.topic,
    eventType: FULFILLMENT_EVENTS.SHIPPED,
    aggregateType: 'Fulfillment',
    aggregateId: completion.fulfillmentOrderId,
    partitionKey: completion.fulfillmentOrderId,
    idempotencyKey: `${completion.fulfillmentOrderId}:fully-shipped`,
    payload: validPayload,
  };
}
