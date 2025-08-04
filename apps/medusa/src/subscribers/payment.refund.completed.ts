import { refundCompletedWorkFlow } from '@medusa/workflows/payments/workflows/refund-completed';
import { IPaymentModuleService } from '@medusajs/framework/types';
import { Modules } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';

/**
 * 외부 Kafka에서 수신한 paymentRefundCompleted 이벤트를 메두사가 내부적으로 처리
 */
export default async function handlePaymentRefundCompleted({
  event,
  container,
}: SubscriberArgs<{
  refundId: string;
  data: any;
  completedAt: Date;
}>) {
  console.log('🔄 Processing external refund event:', event.data);

  const paymentModuleService = container.resolve<IPaymentModuleService>(
    Modules.PAYMENT,
  );

  const refunds = await paymentModuleService.listRefunds(
    { id: ['refund_id'] },
    { relations: ['payment'] },
  );

  try {
    const { result } = await refundCompletedWorkFlow(container).run({
      input: {
        payment_id: refunds[0]?.payment?.id,
        amount: refunds[0]?.amount,
        created_by: refunds[0]?.created_by,
        note: refunds[0]?.note ?? undefined,
      },
    });

    console.log(`✅ External refund processed: ${event.data.refundId}`, result);
  } catch (error) {
    console.error('❌ Failed to process external refund:', error);
    throw error;
  }
}

export const config: SubscriberConfig = {
  event: 'payment.refunded',
  context: {
    subscriberId: 'payment-refund-completed-handler',
  },
};
