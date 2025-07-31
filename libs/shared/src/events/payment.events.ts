import { BaseEventPayload, EventDefinition } from '../../../../libs/events/src';

// 결제 포착 시 발행
export interface PaymentCapturedPayload extends BaseEventPayload {
  order_id: string;
  payment_id: string;
  amount: number;
  currency_code: string;
  created_at: string;
}

export const PAYMENT_EVENTS = {
  PAYMENT_CAPTURED: {
    topic: 'payment.captured',
    payload: {} as PaymentCapturedPayload,
  },
} as const satisfies Record<string, EventDefinition>;

export type Events = {
  'payment.captured': EventDefinition<PaymentCapturedPayload>;
};
