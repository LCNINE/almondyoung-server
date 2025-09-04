import { refundCompletedWorkFlow } from '@medusa/workflows/payments/workflows/refund-completed';
import { IPaymentModuleService } from '@medusajs/framework/types';
import { Modules } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';

/**
 * 외부 Kafka에서 수신한 paymentRefundCompleted 이벤트를 메두사가 내부적으로 처리
 * 즉 modules/events/service.ts에서 payment.refunded라는 외부 이벤트를 메두사 내부 이벤트 버스로 변환하여 작업처리하는곳
 */
export default async function handlePaymentRefundCompleted({
  event,
  container,
}: SubscriberArgs<{
  refundId: string;
  rawData: any;
  refundedAt: Date;
}>) {
  const logger = container.resolve('logger');

  logger.info(
    `🔄 Processing external refund event: ${JSON.stringify(event.data)}`,
  );

  const paymentModuleService = container.resolve<IPaymentModuleService>(
    Modules.PAYMENT,
  );

  const refunds = await paymentModuleService.listRefunds(
    { id: [event.data.refundId] },
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

    logger.info(
      `✅ External refund processed: ${event.data.refundId} ${JSON.stringify(result)}`,
    );
  } catch (error) {
    logger.error('❌ Failed to process external refund:', error);
    throw error;
  }
}

export const config: SubscriberConfig = {
  event: 'payment.refunded',
  context: {
    subscriberId: 'payment-refund-handler',
  },
};
