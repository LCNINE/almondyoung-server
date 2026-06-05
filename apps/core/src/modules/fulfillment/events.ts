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

export type OrderEvent = (typeof ORDER_EVENTS)[keyof typeof ORDER_EVENTS];
export type FulfillmentEvent = (typeof FULFILLMENT_EVENTS)[keyof typeof FULFILLMENT_EVENTS];
