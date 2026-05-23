export const ORDER_EVENTS = {
  CREATED: 'ORDER_CREATED',
  MODIFIED: 'ORDER_MODIFIED',
  CANCELLED: 'ORDER_CANCELLED',
} as const;

export type OrderEvent = (typeof ORDER_EVENTS)[keyof typeof ORDER_EVENTS];
