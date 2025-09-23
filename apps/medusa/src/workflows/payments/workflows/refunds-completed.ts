import {
  createWorkflow,
  transform,
  WorkflowData,
  StepResponse,
  WorkflowResponse,
} from '@medusajs/framework/workflows-sdk';
import {
  useQueryGraphStep,
  addOrderTransactionStep,
  RefundPaymentsWorkflowInput,
  refundPaymentsStep,
} from '@medusajs/medusa/core-flows';
import { PaymentDTO } from '@medusajs/framework/types';
import { isDefined, MathBN } from '@medusajs/framework/utils';

export const refundsCompletedWorkflowId = 'refunds-completed-payments';
/**
 * 환불 완료 워크플로우
 */
export const refundsCompletedWorkFlow = createWorkflow(
  refundsCompletedWorkflowId,
  (input: WorkflowData<RefundPaymentsWorkflowInput>) => {
    const paymentIds = transform({ input }, ({ input }) =>
      input.map((paymentInput) => paymentInput.payment_id),
    );

    const paymentsQuery = useQueryGraphStep({
      entity: 'payments',
      fields: [
        'id',
        'currency_code',
        'refunds.id',
        'refunds.amount',
        'captures.id',
        'captures.amount',
        'payment_collection.order.id',
        'payment_collection.order.currency_code',
      ],
      filters: { id: paymentIds },
      options: { throwIfKeyNotFound: true },
    }).config({ name: 'get-cart' });

    const payments = transform(
      { paymentsQuery },
      ({ paymentsQuery }) => paymentsQuery.data,
    );

    const orderTransactionData = transform(
      { payments, input },
      ({ payments, input }) => {
        const paymentsMap: Record<
          string,
          PaymentDTO & {
            payment_collection: {
              order: { id: string; currency_code: string };
            };
          }
        > = {};

        for (const payment of payments) {
          paymentsMap[payment.id] = payment;
        }

        return input
          .map((paymentInput) => {
            const payment = paymentsMap[paymentInput.payment_id]!;
            const order = payment.payment_collection?.order;

            if (!order) {
              return;
            }

            return {
              order_id: order.id,
              amount: MathBN.mult(paymentInput.amount, -1),
              currency_code: payment.currency_code,
              reference_id: payment.id,
              reference: 'refund',
            };
          })
          .filter(isDefined);
      },
    );

    const orderTransaction = addOrderTransactionStep(orderTransactionData);

    return new WorkflowResponse(orderTransaction);
  },
);
