import { SubscriberArgs, type SubscriberConfig } from '@medusajs/framework';
import { Modules } from '@medusajs/framework/utils';
import EventModuleService from '@modules/events/service';
import { ORDER_EVENTS } from '@libs/shared/src/events/order.events';
import { EVENT_MODULE } from '@modules/events';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

export const config: SubscriberConfig = {
  event: [
    'order.placed', // 주문 생성 시 발생
    'order.canceled', // 주문 취소 시 발생
    'order.return_requested', // 반품 요청 시 발생
  ],
  context: {
    subscriberId: 'order-kafka-bridge',
  },
};

export default async function handler({
  event: { name, data },
  container,
}: SubscriberArgs<{ id?: string; order_id?: string; return_id?: string }>) {
  const eventService = container.resolve<EventModuleService>(EVENT_MODULE);

  const orderService = container.resolve(Modules.ORDER);
  let order;

  if (data.id) {
    order = await orderService.retrieveOrder(data.id, {
      relations: ['items'],
    });
  }

  // 주문 취소 및 반품 요청시 발생
  if (data.order_id || data.return_id) {
    order = await orderService.retrieveOrder(data.order_id!, {
      relations: ['items'],
    });
  }

  console.log(`Order event received: ${name}`, order.id);

  // 주문 생성 시 발생
  if (name === 'order.placed') {
    await eventService.publishEvent(ORDER_EVENTS.ORDER_CREATED.topic, {
      orderId: order.id,
      orderTotal: order.total,
      orderStatus: order.status,
    });
  }

  // 주문 취소 시 발생
  if (name === 'order.canceled') {
    await eventService.publishEvent(ORDER_EVENTS.ORDER_CANCELLED.topic, {
      order_id: order.id,
      canceled_at: order.canceled_at,
    });
  }

  // 반품 요청 시 발생
  if (name === 'order.return_requested') {
    await eventService.publishEvent(ORDER_EVENTS.ORDER_RETURN_REQUESTED.topic, {
      order_id: order.id,
      return_id: order.return_id,
      items: order.items,
      requested_at: format(new Date(), 'yyyy-MM-dd HH:mm:ss', { locale: ko }),
    });
  }
}
