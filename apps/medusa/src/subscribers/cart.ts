import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { CART_EVENTS } from '../../../../libs/shared/src/events/cart.events';
import { container } from '@medusajs/framework';
import { Modules } from '@medusajs/framework/utils';
import EventModuleService from '../modules/events/service';
import { EVENT_MODULE } from '../modules/events';

export const config: SubscriberConfig = {
  event: ['cart.created', 'cart.updated'],
  context: {
    subscriberId: 'cart-kafka-bridge',
  },
};

export default async function handler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const eventService = container.resolve<EventModuleService>(EVENT_MODULE);

  const eventName = event.name;
  const cartId = event.data.id;

  // Cart 서비스로 상세 정보 조회
  const cartService = container.resolve(Modules.CART);

  const cart = await cartService.retrieveCart(cartId, {
    relations: ['items'],
  });

  // Medusa 이벤트를 Kafka 이벤트로 변환
  if (eventName === 'cart.created') {
    await eventService.publishEvent(CART_EVENTS.CART_CREATED.topic, {
      id: cart.id,
      customer_id: cart.customer_id,
      region_id: cart.region_id,
      email: cart.email,
      created_at: cart.created_at,
    });
  } else if (eventName === 'cart.updated') {
    await eventService.publishEvent(CART_EVENTS.CART_UPDATED.topic, {
      id: cart.id,
      items:
        cart.items?.map((item) => ({
          id: item.id,
          variant_id: item.variant_id,
          quantity: item.quantity,
          unit_price: item.unit_price, // 상품 하나당 순수 가격
        })) || [],

      updated_at: cart.updated_at,
    });
  }
}
