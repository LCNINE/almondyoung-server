import { BaseEventPayload, EventDefinition } from '../../../../libs/events/src';

// 주문 생성
export interface OrderCreatedPayload extends BaseEventPayload {
  orderId: string;
  status: string;
  total: number;
  items: Array<{
    id: string;
    quantity: number;
  }>;
}

// 주문 취소
export interface OrderCancelledPayload extends BaseEventPayload {
  orderId: string;
  status: string;
}

// 결제 완료
export interface OrderPaymentCompletePayload extends BaseEventPayload {
  order_id: string;
  payment_id: string;
  amount: number;
  currency_code: string;
  captured_at: string;
}

// 반품 요청
export interface OrderReturnRequestedPayload extends BaseEventPayload {
  order_id: string;
  return_id: string;
  items: Array<{
    item_id: string;
    quantity: number;
    reason: string;
  }>;
  note?: string;
  requested_at: string;
}

// 환불 처리
export interface OrderRefundCreatedPayload extends BaseEventPayload {
  order_id: string;
  refund_id: string;
  amount: number;
  currency_code: string;
  reason: string;
  note?: string;
  created_at: string;
}

export const ORDER_EVENTS = {
  ORDER_CREATED: {
    topic: 'order.created',
    payload: {} as OrderCreatedPayload,
  },
  ORDER_CANCELLED: {
    topic: 'order.cancelled',
    payload: {} as OrderCancelledPayload,
  },
  ORDER_PAYMENT_COMPLETE: {
    topic: 'order.payment_complete',
    payload: {} as OrderPaymentCompletePayload,
  },
  ORDER_RETURN_REQUESTED: {
    topic: 'order.return_requested',
    payload: {} as OrderReturnRequestedPayload,
  },
  ORDER_REFUND_CREATED: {
    topic: 'order.refund_created',
    payload: {} as OrderRefundCreatedPayload,
  },
} as const satisfies Record<string, EventDefinition>;

export type Events = {
  'order.created': EventDefinition<OrderCreatedPayload>;
  'order.cancelled': EventDefinition<OrderCancelledPayload>;
  'order.payment_complete': EventDefinition<OrderPaymentCompletePayload>;
  'order.return_requested': EventDefinition<OrderReturnRequestedPayload>;
  'order.refund_created': EventDefinition<OrderRefundCreatedPayload>;
};
