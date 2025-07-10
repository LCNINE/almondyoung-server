import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { EventPublisherService } from '../../../../libs/events/src';
import {
  Events,
  CART_EVENTS,
} from '../../../../libs/shared/src/events/cart.events';
import { container } from '@medusajs/framework';
import { Modules } from '@medusajs/framework/utils';

interface MedusaCartData {
  id: string;
  customer_id: string;
  region_id: string;
  items: Array<{
    id: string;
    title: string;
    quantity: number;
    unit_price: number;
    variant_id: string;
  }>;
  total: number;
  subtotal: number;
}

export const config: SubscriberConfig = {
  event: ['cart.created', 'cart.updated'],
  context: {
    subscriberId: 'cart-kafka-bridge',
  },
};

export const handler = async (data: SubscriberArgs<MedusaCartData>) => {
  const eventPublisher =
    data.container.resolve<EventPublisherService<Events>>('eventPublisher');

  // Medusa 이벤트를 Kafka 이벤트로 변환
  const eventType = data.event.name;
  const eventData = data.event.data;

  const cartService = data.container.resolve(Modules.CART);
  const cart = await cartService.retrieveCart(data.event.data.id, {
    relations: ['items'],
  });

  console.log('cart:', cart);

  if (eventType === 'cart.created') {
    await eventPublisher.publishEvent(CART_EVENTS.CART_CREATED.topic, {
      id: eventData.id,
      customer_id: eventData.customer_id,
      region_id: eventData.region_id,
      created_at: new Date().toISOString(),
    });
  } else if (eventType === 'cart.updated') {
    await eventPublisher.publishEvent(CART_EVENTS.CART_UPDATED.topic, {
      id: eventData.id,
      items: eventData.items,
      total: eventData.total,
      subtotal: eventData.subtotal,
      updated_at: new Date().toISOString(),
    });
  }
};
