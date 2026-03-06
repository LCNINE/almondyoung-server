import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { capturePaymentWorkflow, refundPaymentWorkflow } from '@medusajs/core-flows';
import { logger } from '@medusajs/framework';

type CaptureOrderPaymentsInput = {
  paymentIds: string[];
  customerId: string;
};

type CompensationData = {
  capturedIds: string[];
  customerId: string;
};

export const captureOrderPaymentsStep = createStep(
  'capture-order-payments',
  async ({ paymentIds, customerId }: CaptureOrderPaymentsInput, { container }) => {
    //
    const capturedIds: string[] = [];

    for (const paymentId of paymentIds) {
      await capturePaymentWorkflow(container).run({
        input: {
          payment_id: paymentId,
          captured_by: customerId,
        },
      });
      capturedIds.push(paymentId);
    }

    return new StepResponse(capturedIds, { capturedIds, customerId } as CompensationData);
  },
  // 롤백: 캡처된 결제를 환불 처리
  async (compensationData: CompensationData, { container }) => {
    if (!compensationData?.capturedIds?.length) {
      return;
    }

    for (const paymentId of compensationData.capturedIds) {
      try {
        await refundPaymentWorkflow(container).run({
          input: {
            payment_id: paymentId,
            created_by: compensationData.customerId,
          },
        });
        logger.info(`Payment ${paymentId} refunded (compensation)`);
      } catch (err: any) {
        logger.error(`Failed to refund payment ${paymentId} during compensation: ${err?.message}`);
      }
    }
  },
);
