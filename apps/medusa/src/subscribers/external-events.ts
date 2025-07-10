import { type SubscriberConfig } from '@medusajs/medusa';
import { EventPublisherService } from '../../../../libs/events/src';

export const config: SubscriberConfig = {
  event: 'kafka.*',
  context: {
    subscriberId: 'external-events-handler',
  },
};

export const handler = async ({ data, eventName, container }) => {
  const eventBus = container.resolve('eventBusService');

  // Kafka 이벤트를 Medusa 이벤트로 변환
  switch (eventName) {
    // 주문 관련 이벤트
    case 'kafka.user.created':
      await eventBus.emit('user.created', data);
      break;

    // 장바구니 관련 이벤트
    case 'kafka.cart.created':
      await eventBus.emit('cart.created', data);
      break;
    case 'kafka.cart.updated':
      await eventBus.emit('cart.updated', data);
      break;
  }
};
