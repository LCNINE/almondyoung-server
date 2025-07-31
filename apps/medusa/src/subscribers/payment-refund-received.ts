import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';

/**
 * 외부 Kafka에서 수신한 payment.refunded 이벤트를 메두사가 내부적으로 처리
 */
export default async function handlePaymentRefundReceived({
  event,
  container,
}: SubscriberArgs<{
  refundId: string;
  data: any;
  completedAt: Date;
}>) {
  console.log('🔄 Processing external refund event:', event.data);

  const paymentModuleService = container.resolve(Modules.PAYMENT);
  const orderModule = container.resolve(Modules.ORDER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  try {
    // 1. Refund 객체 조회
    const refunds = await paymentModuleService.listRefunds({
      id: [event.data.refundId],
    });

    if (!refunds.length) {
      throw new Error(`Refund not found: ${event.data.refundId}`);
    }

    const refund = refunds[0];

    // 2. Payment 객체 조회
    if (!refund.payment?.id) {
      throw new Error(
        `No payment associated with refund: ${event.data.refundId}`,
      );
    }

    const payment = await paymentModuleService.retrievePayment(
      refund.payment.id,
    );

    if (!payment) {
      throw new Error(`Payment not found: ${refund.payment.id}`);
    }

    // 3. Payment Collection을 통해 Order 조회
    if (payment.payment_collection_id) {
      const { data: paymentCollections } = await query.graph({
        entity: 'payment_collection',
        fields: [
          'order.*',
          'amount',
          'currency_code',
          'created_at',
          'refunded_amount',
        ],
        filters: { id: payment.payment_collection_id },
      });

      const orderId = paymentCollections[0]?.order?.id;

      if (orderId) {
        const order = await orderModule.retrieveOrder(orderId);

        if (order) {
          // 주문 환불 처리 워크플로우 실행
          console.log(`Processing refund for order ${orderId}`);

          // 환불 금액이 있다면 주문에 반영
          if (refund.amount) {
            // TODO: 환불 처리 로직 구현
            // 예: 주문 상태 업데이트, 재고 조정 등
            console.log(`Refund amount: ${refund.amount}`);

            // 주문 상태 업데이트 예시:
            // await orderModule.update(orderId, {
            //   status: "refunded",
            //   refund_amount: refund.amount
            // });
          }
        }
      }
    }

    console.log(`✅ External refund processed: ${event.data.refundId}`);
  } catch (error) {
    console.error('❌ Failed to process external refund:', error);
    throw error;
  }
}

export const config: SubscriberConfig = {
  event: 'payment.refund.received',
  context: {
    subscriberId: 'payment-refund-received-handler',
  },
};
