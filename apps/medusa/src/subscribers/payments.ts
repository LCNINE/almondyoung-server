import {
  type SubscriberArgs,
  type SubscriberConfig,
} from '@medusajs/framework';
import {
  AbstractPaymentProvider,
  ContainerRegistrationKeys,
  Modules,
} from '@medusajs/framework/utils';
import { EVENT_MODULE } from '../modules/events';
import EventModuleService from '../modules/events/service';
import { PAYMENT_EVENTS } from '@libs/shared/src/events/payment.events';

export const config: SubscriberConfig = {
  event: [
    'payment.captured', // 결제가 포착되면 발행
    'payment.refunded', // 환불 완료 시 발행
  ],
  context: {
    subscriberId: 'payments-kafka-bridge',
  },
};

export default async function handler({
  event: { name, data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const eventService = container.resolve<EventModuleService>(EVENT_MODULE);

  const paymentService = container.resolve(Modules.PAYMENT);
  const payment = await paymentService.retrievePayment(data.id);

  // payment collection 조회
  const paymentModuleService = container.resolve(Modules.PAYMENT);
  const paymentCollection =
    await paymentModuleService.retrievePaymentCollection(
      payment.payment_collection_id,
    );

  // order 조회
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: paymentCollections } = await query.graph({
    entity: 'payment_collection',
    fields: [
      'order.*',
      'amount',
      'currency_code',
      'created_at',
      'refunded_amount',
    ],
    filters: { id: paymentCollection.id },
  });

  const orderId = paymentCollections[0]?.order?.id ?? null;

  console.log('paymentCollections', paymentCollections);

  // 결제 포착 시 발행
  if (name === 'payment.captured') {
    await eventService.publishEvent(PAYMENT_EVENTS.CAPTURED.topic, {
      order_id: orderId,
      payment_id: payment.id,
      amount: payment.amount,
      currency_code: payment.currency_code,
      created_at: payment.created_at,
    });
  }
}
