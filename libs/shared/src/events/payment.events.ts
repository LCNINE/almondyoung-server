import { BaseEventPayload, EventDefinition } from '../../../../libs/events/src';

// 결제 포착 시 발행
export interface PaymentCapturedPayload extends BaseEventPayload {
  order_id: string;
  payment_id: string;
  amount: number;
  currency_code: string;
  created_at: string;
}

// 결제 환불 요청 시 발행
export interface PaymentRefundRequestPayload extends BaseEventPayload {
  refund_id: string;
  user_id: string;
  paymentEventId: string;
  amount: number;
  reason?: string;
}

// 결제 환불 완료 시 발행
export interface PaymentRefundCompletedPayload extends BaseEventPayload {
  refundId: string;
  data: any;
  completedAt: Date;
}

export const PAYMENT_EVENTS = {
  CAPTURED: {
    topic: 'payment.captured',
    payload: {} as PaymentCapturedPayload,
  },
  REFUND_REQUEST: {
    topic: 'payment.refund.request',
    payload: {} as PaymentRefundRequestPayload,
  },
  REFUND_COMPLETED: {
    topic: 'payment.refund.completed',
    payload: {} as PaymentRefundCompletedPayload,
  },
} as const satisfies Record<string, EventDefinition>;

export type Events = {
  'payment.captured': EventDefinition<PaymentCapturedPayload>;
};
