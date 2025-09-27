import { BaseEventPayload, EventDefinition } from '../../../../libs/events/src';

// 장바구니 생성
export interface CartCreatedPayload extends BaseEventPayload {
  id: string;
  customer_id: string;
  region_id: string;
  created_at: string;
}

// 장바구니 변경
export interface CartUpdatedPayload extends BaseEventPayload {
  id: string;
  items: Array<{
    id: string;
    title: string;
    quantity: number;
    unit_price: number;
    variant_id: string;
  }>;
  total: number;
  subtotal: number;
  updated_at: string;
}

export const CART_EVENTS = {
  CART_CREATED: {
    topic: 'cart.created',
    payload: {} as CartCreatedPayload,
  },
  CART_UPDATED: {
    topic: 'cart.updated',
    payload: {} as CartUpdatedPayload,
  },
} as const satisfies Record<string, EventDefinition>;

export type Events = {
  'cart.created': EventDefinition<CartCreatedPayload>;
  'cart.updated': EventDefinition<CartUpdatedPayload>;
};
