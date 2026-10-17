import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { capturePaymentWorkflow, refundPaymentWorkflow } from '@medusajs/core-flows';
import { logger } from '@medusajs/framework';
import type { MedusaContainer } from '@medusajs/framework/types';
import { BigNumber, Modules } from '@medusajs/framework/utils';

import { withRefundKind } from '../../../modules/almond-payment/refund-data';
import { writePaymentData } from '../settlement/payment-data';

type CaptureOrderPaymentsInput = {
  paymentIds: string[];
  customerId: string;
};

type CompensationData = {
  capturedIds: string[];
  customerId: string;
};

/**
 * 금액 없이 refundPaymentWorkflow 를 부르면 캡처분 전액을 환불한다 — 종류 표식(PAYMENT_ERROR)은 그 금액으로 붙인다.
 * refundPayment 는 표식 금액이 환불 금액과 같을 때만 wallet 에 kind 를 싣는다.
 */
async function markPaymentError(container: MedusaContainer, paymentId: string): Promise<void> {
  const paymentModule = container.resolve(Modules.PAYMENT);
  const payment = await paymentModule.retrievePayment(paymentId, { select: ['id', 'data', 'amount'] });
  await writePaymentData(
    paymentModule,
    paymentId,
    withRefundKind(payment.data ?? {}, { kind: 'PAYMENT_ERROR', amount: new BigNumber(payment.amount).numeric }),
  );
}

export const captureOrderPaymentsStep = createStep(
  'capture-order-payments',
  async ({ paymentIds, customerId }: CaptureOrderPaymentsInput, { container }) => {
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
        // 종류 표식은 분류용일 뿐이다 — 쓰기에 실패해도 롤백 환불은 멈추면 안 된다
        await markPaymentError(container, paymentId).catch((markError: unknown) => {
          logger.warn(`Failed to mark refund kind for payment ${paymentId}: ${(markError as Error)?.message}`);
        });
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
