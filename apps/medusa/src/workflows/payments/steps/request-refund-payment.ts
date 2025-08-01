import { PAYMENT_EVENTS } from '@libs/shared/src/events/payment.events';
import { EVENT_MODULE } from '@medusa/modules/events';
import EventModuleService from '@medusa/modules/events/service';
import { IPaymentModuleService, Logger } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { RefundPaymentStepInput } from '@medusajs/medusa/core-flows';
import { randomUUID } from 'crypto';

interface RefundRequestData {
  refundId: string;
  paymentEventId: string;
  amount: number;
  reason?: string;
}

export const requestRefundPaymentStepId = 'request-refund-payment';

/**
 * 결제 환불 요청 이벤트를 발행합니다.
 */
export const requestRefundPaymentStep = createStep(
  requestRefundPaymentStepId,
  async (
    {
      payment,
      input,
    }: { payment: any; input: RefundPaymentStepInput & { note?: string } },
    { container },
  ) => {
    const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);

    const eventModuleService =
      container.resolve<EventModuleService>(EVENT_MODULE);

    const paymentModule = container.resolve<IPaymentModuleService>(
      Modules.PAYMENT,
    );

    const refundData: RefundRequestData = {
      refundId: payment.refunds.id,
      paymentEventId: `pevt_${randomUUID()}`,
      amount: Number(input.amount),
      reason: input?.note,
    };

    await eventModuleService.publishEvent(PAYMENT_EVENTS.REFUND_REQUEST.topic, {
      refundData,
    });

    return new StepResponse(refundData);
  },
);
