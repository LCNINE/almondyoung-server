import {
  type SubscriberConfig,
  type SubscriberArgs,
} from '@medusajs/framework';
import { Modules } from '@medusajs/framework/utils';
import { EventPublisherService } from '../../../../libs/events/src';
import {
  Events,
  ORDER_EVENTS,
} from '../../../../libs/shared/src/events/order.events';

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
  const eventPublisher =
    container.resolve<EventPublisherService<Events>>('eventPublisher');

  // Medusa 공식 서비스로 주문 상세 조회
  const orderService = container.resolve(Modules.ORDER);
  const order = await orderService.retrieveOrder(data.id, {
    relations: ['items', 'payments', 'returns', 'refunds'],
  });

  console.log('order:', order);

  if (name === 'order.placed') {
    await eventPublisher.publishEvent(ORDER_EVENTS.ORDER_CREATED.topic, {
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
    await eventPublisher.publishEvent(ORDER_EVENTS.ORDER_CANCELLED.topic, {
      orderId: order.id,
      status: order.status,
    });
  } else if (name === 'order.payment_complete') {
    // const payment = order.payments[order.payments.length - 1];
    // await eventPublisher.publishEvent(
    //   ORDER_EVENTS.ORDER_PAYMENT_COMPLETE.topic,
    //   {
    //     order_id: order.id,
    //     payment_id: payment.id,
    //     amount: payment.amount,
    //     currency_code: payment.currency_code,
    //     captured_at: payment.captured_at,
    //   },
    // );
  } else if (name === 'order.return_requested') {
    //   const return_request = order.returns[order.returns.length - 1];
    //   await eventPublisher.publishEvent(
    //     ORDER_EVENTS.ORDER_RETURN_REQUESTED.topic,
    //     {
    //       order_id: order.id,
    //       return_id: return_request.id,
    //       items: return_request.items,
    //       note: return_request.note,
    //       requested_at: return_request.created_at,
    //     },
    //   );
    // } else if (name === 'order.refund_created') {
    //   const refund = order.refunds[order.refunds.length - 1];
    //   await eventPublisher.publishEvent(ORDER_EVENTS.ORDER_REFUND_CREATED.topic, {
    //     order_id: order.id,
    //     refund_id: refund.id,
    //     amount: refund.amount,
    //     currency_code: order.payments[0]?.currency_code,
    //     reason: refund.reason,
    //     note: refund.note,
    //     created_at: refund.created_at,
    //   });
  }
}
