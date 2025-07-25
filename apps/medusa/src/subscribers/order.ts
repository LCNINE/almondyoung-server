import {
  type SubscriberConfig,
  type SubscriberArgs,
} from '@medusajs/framework';
import { Modules } from '@medusajs/framework/utils';
import EventModuleService from '../modules/events/service';
import { ORDER_EVENTS } from '../../../../libs/shared/src/events/order.events';
import { EVENT_MODULE } from '../modules/events';

export const config: SubscriberConfig = {
  event: [
    'order.placed',
    'order.canceled',
    'order.payment_complete',
    'order.return_requested',
    'order.refund_created',
  ],
  context: {
    subscriberId: 'order-kafka-bridge',
  },
};

export default async function handler({
  event: { name, data },
  container,
}: SubscriberArgs<{ id: string }>) {
  // events 모듈에서 서비스 가져오기
  const eventService = container.resolve<EventModuleService>(EVENT_MODULE);

  // Medusa 공식 서비스로 주문 상세 조회
  const orderService = container.resolve(Modules.ORDER);
  const order: any = await orderService.retrieveOrder(data.id, {
    relations: ['items', 'payments', 'returns', 'refunds'],
  });

  console.log(`Order event received: ${name}`, order.id);

  if (name === 'order.placed') {
    await eventService.publishEvent(ORDER_EVENTS.ORDER_CREATED.topic, {
      orderId: order.id,
      status: order.status,
      total: +order.total,
      items:
        order?.items?.map((item) => ({
          id: item.id,
          quantity: item.quantity,
        })) ?? [],
    });
  } else if (name === 'order.canceled') {
    await eventService.publishEvent(ORDER_EVENTS.ORDER_CANCELLED.topic, {
      orderId: order.id,
      status: order.status,
    });
  } else if (name === 'order.payment_complete') {
    const payment = order.payments?.[0];
    await eventService.publishEvent(ORDER_EVENTS.ORDER_PAYMENT_COMPLETE.topic, {
      orderId: order.id,
      paymentId: payment?.id,
      amount: payment?.amount,
      currencyCode: payment?.currency_code,
      capturedAt: payment?.captured_at,
    });
  } else if (name === 'order.return_requested') {
    const returnRequest = order.returns?.[0];
    await eventService.publishEvent(ORDER_EVENTS.ORDER_RETURN_REQUESTED.topic, {
      orderId: order.id,
      returnId: returnRequest?.id,
      items:
        returnRequest?.items?.map((item) => ({
          id: item.id,
          quantity: item.quantity,
        })) ?? [],
      note: returnRequest?.note,
      requestedAt: returnRequest?.created_at,
    });
  } else if (name === 'order.refund_created') {
    const refund = order.refunds?.[0];
    await eventService.publishEvent(ORDER_EVENTS.ORDER_REFUND_CREATED.topic, {
      orderId: order.id,
      refundId: refund?.id,
      amount: refund?.amount,
      currencyCode: order.payments?.[0]?.currency_code,
      reason: refund?.reason,
      note: refund?.note,
      createdAt: refund?.created_at,
    });
  }
}
