import { BaseEventPayload, EventDefinition } from '@app/events';

export interface OrderCreatedPayload extends BaseEventPayload {
  userId: string;
  orderId: string;
  totalAmount: number;
  currency: string;
  customerEmail?: string;
}

export interface PaymentCompletedPayload extends BaseEventPayload {
  userId: string;
  orderId: string;
  paymentAmount: number;
  currency: string;
  customerEmail?: string;
}

export const MEDUSA_EVENTS = {
  ORDER_CREATED: {
    topic: 'order.created',
    payload: {} as OrderCreatedPayload,
  },
  PAYMENT_COMPLETED: {
    topic: 'payment.completed',
    payload: {} as PaymentCompletedPayload,
  },
} as const satisfies Record<string, EventDefinition>;

export type MedusaEvents = typeof MEDUSA_EVENTS;
