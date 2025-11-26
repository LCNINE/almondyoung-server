export const ORDER_EVENTS = {
  CREATED: 'ORDER_CREATED',
  CONFIRMED: 'ORDER_CONFIRMED',
  MODIFIED: 'ORDER_MODIFIED',
  CANCELLED: 'ORDER_CANCELLED',
} as const;

// event-contracts 형식에 맞춘 이벤트 타입 (Kafka 발행용)
export const FULFILLMENT_EVENTS = {
  CREATED: 'FulfillmentCreated',
  READY: 'FulfillmentReady',
  LABELLED: 'FulfillmentLabeled',
  SHIPPED: 'FulfillmentShipped',
  CANCELLED: 'FulfillmentCancelled',
} as const;

export type OrderEvent = typeof ORDER_EVENTS[keyof typeof ORDER_EVENTS];
export type FulfillmentEvent = typeof FULFILLMENT_EVENTS[keyof typeof FULFILLMENT_EVENTS];


