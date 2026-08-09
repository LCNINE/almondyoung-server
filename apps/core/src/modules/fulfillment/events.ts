import {
  createFulfillmentShippedV1Projection,
  FULFILLMENT_STREAM,
  FULFILLMENT_V2_STREAM,
  FulfillmentProgressedPayload,
  FulfillmentReopenedPayload,
  FulfillmentDeliveredPayload,
  FulfillmentShippedPayload,
  FulfillmentV1CompletionSummary,
  SHIPMENT_STREAM,
  ShipmentDeliveredPayload,
  ShipmentShippedPayload,
  ShipmentDispatchRecalledPayload,
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

/**
 * 아웃박스 적재 인자 (ADR-0029 §5-1, Task 6-C-2).
 *
 * **`topic` 과 `aggregateType` 이 빠졌다 — 파생되기 때문이다.** 회수 전에는 이 레코드가 두
 * 필드를 직접 들고 있었고, 그 값이 스트림 설정과 어긋나도 아무도 몰랐다(실제로 몇 곳이
 * 어긋나 있었다: `'fulfillment'` vs `Fulfillment`, `'order'` 등). 이제 `publisher.enqueue`
 * 가 `streamConfig` 에서 가져오므로 그 두 사실의 소유자가 하나다.
 *
 * `eventType` 이 `TEventKey` 로 좁혀져 있는 것도 같은 이유다 — 계약에 없는 이름은 컴파일
 * 단계에서 막힌다. 빌더의 남은 책임은 **멱등 키 규약**과 **파티션 키**, 그리고 적재 전 파싱이다.
 */
export interface FulfillmentOutboxEvent<TEventKey extends string, TPayload> {
  eventType: TEventKey;
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
): FulfillmentOutboxEvent<'ShipmentShipped', ShipmentShippedPayload> {
  const validPayload = SHIPMENT_STREAM.events.ShipmentShipped.schema!.parse(payload);
  return {
    eventType: SHIPMENT_EVENTS.SHIPPED,
    aggregateId: validPayload.shipmentId,
    partitionKey: validPayload.shipmentId,
    idempotencyKey: validPayload.dispatchAttemptId,
    payload: validPayload,
  };
}

/** One progress fact per dispatch attempt and affected fulfillment order. */
export function fulfillmentProgressedOutboxEvent(
  payload: FulfillmentProgressedPayload,
): FulfillmentOutboxEvent<'FulfillmentProgressed', FulfillmentProgressedPayload> {
  const validPayload = FULFILLMENT_V2_STREAM.events.FulfillmentProgressed.schema!.parse(payload);
  return {
    eventType: FULFILLMENT_V2_EVENTS.PROGRESSED,
    aggregateId: validPayload.fulfillmentOrderId,
    partitionKey: validPayload.fulfillmentOrderId,
    idempotencyKey: `${validPayload.dispatchAttemptId}:${validPayload.fulfillmentOrderId}`,
    payload: validPayload,
  };
}

export function shipmentDispatchRecalledOutboxEvent(
  payload: ShipmentDispatchRecalledPayload,
): FulfillmentOutboxEvent<'ShipmentDispatchRecalled', ShipmentDispatchRecalledPayload> {
  const validPayload = SHIPMENT_STREAM.events.ShipmentDispatchRecalled.schema!.parse(payload);
  return {
    eventType: SHIPMENT_EVENTS.DISPATCH_RECALLED,
    aggregateId: validPayload.shipmentId,
    partitionKey: validPayload.shipmentId,
    idempotencyKey: validPayload.recallOperationId,
    payload: validPayload,
  };
}

export function fulfillmentReopenedOutboxEvent(
  payload: FulfillmentReopenedPayload,
): FulfillmentOutboxEvent<'FulfillmentReopened', FulfillmentReopenedPayload> {
  const validPayload = FULFILLMENT_V2_STREAM.events.FulfillmentReopened.schema!.parse(payload);
  return {
    eventType: FULFILLMENT_V2_EVENTS.REOPENED,
    aggregateId: validPayload.fulfillmentOrderId,
    partitionKey: validPayload.fulfillmentOrderId,
    idempotencyKey: `${validPayload.recallOperationId}:${validPayload.fulfillmentOrderId}`,
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
): FulfillmentOutboxEvent<'FulfillmentShipped', FulfillmentShippedPayload> {
  const validPayload = createFulfillmentShippedV1Projection(payload, completion);
  return {
    eventType: FULFILLMENT_EVENTS.SHIPPED,
    aggregateId: completion.fulfillmentOrderId,
    partitionKey: completion.fulfillmentOrderId,
    idempotencyKey: `${completion.fulfillmentOrderId}:fully-shipped`,
    payload: validPayload,
  };
}

/** A carrier may send several delivered webhooks, but an attempt is delivered only once logically. */
export function shipmentDeliveredOutboxEvent(
  payload: ShipmentDeliveredPayload,
): FulfillmentOutboxEvent<'ShipmentDelivered', ShipmentDeliveredPayload> {
  const validPayload = SHIPMENT_STREAM.events.ShipmentDelivered.schema!.parse(payload);
  return {
    eventType: SHIPMENT_EVENTS.DELIVERED,
    aggregateId: validPayload.shipmentId,
    partitionKey: validPayload.shipmentId,
    idempotencyKey: validPayload.dispatchAttemptId,
    payload: validPayload,
  };
}

/** V1 delivery is emitted only by the attempt that completes delivery evidence for the FO. */
export function fulfillmentDeliveredV1OutboxEvent(
  payload: FulfillmentDeliveredPayload,
): FulfillmentOutboxEvent<'FulfillmentDelivered', FulfillmentDeliveredPayload> {
  const validPayload = FULFILLMENT_STREAM.events.FulfillmentDelivered.schema!.parse(payload);
  return {
    eventType: FULFILLMENT_EVENTS.DELIVERED,
    aggregateId: validPayload.fulfillmentId,
    partitionKey: validPayload.fulfillmentId,
    idempotencyKey: `${validPayload.fulfillmentId}:fully-delivered`,
    payload: validPayload,
  };
}
