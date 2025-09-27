import {
  createWorkflow,
  transform,
  WorkflowData,
  StepResponse,
  WorkflowResponse,
  when,
} from '@medusajs/framework/workflows-sdk';
import {
  useQueryGraphStep,
  addOrderTransactionStep,
  RefundPaymentsWorkflowInput,
  refundPaymentsStep,
  RefundPaymentWorkflowInput,
  useRemoteQueryStep,
} from '@medusajs/medusa/core-flows';
import { PaymentDTO } from '@medusajs/framework/types';
import { isDefined, MathBN } from '@medusajs/framework/utils';

export const refundCompletedWorkflowId = 'refund-completed-payments';
/**
 * 환불 완료 워크플로우
 */
export const refundCompletedWorkFlow = createWorkflow(
  refundCompletedWorkflowId,
  (input: WorkflowData<RefundPaymentWorkflowInput & { note?: string }>) => {
    const payment = useRemoteQueryStep({
      entry_point: 'payment',
      fields: [
        'id',
        'payment_collection_id',
        'currency_code',
        'amount',
        'raw_amount',
      ],
      variables: { id: input.payment_id },
      list: false,
      throw_if_key_not_found: true,
    });

    const orderPaymentCollection = useRemoteQueryStep({
      entry_point: 'order_payment_collection',
      fields: ['order.id'],
      variables: { payment_collection_id: payment.payment_collection_id },
      list: false,
      throw_if_key_not_found: true,
    }).config({ name: 'order-payment-collection' });

    const order = useRemoteQueryStep({
      entry_point: 'order',
      fields: ['id', 'summary', 'currency_code', 'region_id'],
      variables: { id: orderPaymentCollection.order.id },
      throw_if_key_not_found: true,
      list: false,
    }).config({ name: 'order' });

    when({ orderPaymentCollection }, ({ orderPaymentCollection }) => {
      return !!orderPaymentCollection?.order?.id;
    }).then(() => {
      const orderTransactionData = transform(
        { input, payment, orderPaymentCollection },
        ({ input, payment, orderPaymentCollection }) => {
          return {
            order_id: orderPaymentCollection.order.id,
            amount: MathBN.mult(
              input.amount ?? payment.raw_amount ?? payment.amount,
              -1,
            ),
            currency_code: payment.currency_code ?? order.currency_code,
            reference_id: payment.id,
            reference: 'refund',
          };
        },
      );

      addOrderTransactionStep(orderTransactionData);
    });

    return new WorkflowResponse(payment);
  },
);
