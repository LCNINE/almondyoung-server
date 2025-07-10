import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { EventPublisherService } from '../../../../libs/events/src';
import { EventDefinition } from '../../../../libs/events/src/types';
import {
  Events,
  ORDER_EVENTS,
} from '../../../../libs/shared/src/events/order.events';

interface MedusaOrderData {
  id: string;
  status: string;
  total: number;
  items: Array<{
    id: string;
    quantity: number;
  }>;
  payment_status: string;
  payments: Array<{
    id: string;
    amount: number;
    currency_code: string;
    captured_at: string;
  }>;
  returns: Array<{
    id: string;
    items: Array<{
      item_id: string;
      quantity: number;
      reason: string;
    }>;
    note?: string;
    created_at: string;
  }>;
  refunds: Array<{
    id: string;
    amount: number;
    reason: string;
    note?: string;
    created_at: string;
  }>;
}

export const config: SubscriberConfig = {
  event: 'order.*',
  context: {
    subscriberId: 'order-kafka-bridge',
  },
};

export const handler = async (data: SubscriberArgs<MedusaOrderData>) => {
  const eventPublisher =
    data.container.resolve<EventPublisherService<Events>>('eventPublisher');

  // Medusa 이벤트를 Kafka 이벤트로 변환
  const eventType = data.event.name;
  const eventData = data.event.data;

  if (eventType === 'order.placed') {
    await eventPublisher.publishEvent(ORDER_EVENTS.ORDER_CREATED.topic, {
      orderId: eventData.id,
      status: eventData.status,
      total: eventData.total,
      items: eventData.items,
    });
  } else if (eventType === 'order.canceled') {
    await eventPublisher.publishEvent(ORDER_EVENTS.ORDER_CANCELLED.topic, {
      orderId: eventData.id,
      status: eventData.status,
    });
  } else if (eventType === 'order.payment_captured') {
    const payment = eventData.payments[eventData.payments.length - 1]; // 가장 최근 결제 정보
    await eventPublisher.publishEvent(
      ORDER_EVENTS.ORDER_PAYMENT_COMPLETE.topic,
      {
        order_id: eventData.id,
        payment_id: payment.id,
        amount: payment.amount,
        currency_code: payment.currency_code,
        captured_at: payment.captured_at,
      },
    );
  } else if (eventType === 'order.return_requested') {
    const return_request = eventData.returns[eventData.returns.length - 1];
    await eventPublisher.publishEvent(
      ORDER_EVENTS.ORDER_RETURN_REQUESTED.topic,
      {
        order_id: eventData.id,
        return_id: return_request.id,
        items: return_request.items,
        note: return_request.note,
        requested_at: return_request.created_at,
      },
    );
  } else if (eventType === 'order.refund_created') {
    const refund = eventData.refunds[eventData.refunds.length - 1];
    await eventPublisher.publishEvent(ORDER_EVENTS.ORDER_REFUND_CREATED.topic, {
      order_id: eventData.id,
      refund_id: refund.id,
      amount: refund.amount,
      currency_code: eventData.payments[0].currency_code, // 원래 결제의 통화 코드 사용
      reason: refund.reason,
      note: refund.note,
      created_at: refund.created_at,
    });
  }
};
