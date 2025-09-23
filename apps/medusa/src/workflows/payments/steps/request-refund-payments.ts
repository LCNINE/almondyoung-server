import { PAYMENT_EVENTS } from '@libs/shared/src/events/payment.events';
import { EVENT_MODULE } from '@medusa/modules/events';
import EventModuleService from '@medusa/modules/events/service';
import { IPaymentModuleService, Logger } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { RefundPaymentsStepInput } from '@medusajs/medusa/core-flows';
import { randomUUID } from 'crypto';

interface RefundRequestData {
  refundId: string;
  data: {
    paymentEventId: string;
    amount: number;
    reason?: string;
  };
}

export const requestRefundPaymentsStepId = 'request-refund-payments';

/**
 * 결제 환불 요청 이벤트를 발행합니다.
 */
export const requestRefundPaymentsStep = createStep(
  requestRefundPaymentsStepId,
  async (
    { payments, input }: { payments: any[]; input: RefundPaymentsStepInput },
    { container },
  ) => {
    const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);

    const eventModuleService =
      container.resolve<EventModuleService>(EVENT_MODULE);

    const paymentModule = container.resolve<IPaymentModuleService>(
      Modules.PAYMENT,
    );

    const successfulRefunds: RefundRequestData[] = [];

    for (const refundInput of input) {
      const payment = payments.find(
        (p: any) => p.id === refundInput.payment_id,
      );
      if (!payment) {
        logger.error(`Payment not found: ${refundInput.payment_id}`);
        // TODO: 환불 실패 이벤트 발행(필요하면 추가)
        continue;
      }

      const refundData: RefundRequestData = {
        refundId: payment.refunds.id,
        data: {
          paymentEventId: `pevt_${randomUUID()}`,
          amount: Number(refundInput.amount),
          reason: refundInput.note,
        },
      };

      await eventModuleService.publishEvent(
        PAYMENT_EVENTS.REFUND_REQUEST.topic,
        { refundData },
      );

      successfulRefunds.push(refundData);
    }

    return new StepResponse(successfulRefunds);
  },
);
