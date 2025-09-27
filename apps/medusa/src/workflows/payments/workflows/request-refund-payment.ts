import {
  createWorkflow,
  transform,
  when,
  WorkflowData,
  WorkflowResponse,
} from '@medusajs/framework/workflows-sdk';
import {
  RefundPaymentsWorkflowInput,
  RefundPaymentWorkflowInput,
  useQueryGraphStep,
  useRemoteQueryStep,
  validatePaymentsRefundStep,
  validateRefundStep,
} from '@medusajs/medusa/core-flows';
import { requestRefundPaymentsStep } from '../steps/request-refund-payments';
import { requestRefundPaymentStep } from '../steps/request-refund-payment';
import { MathBN } from '@medusajs/framework/utils';

export const requestRefundPaymentWorkFlowId = 'request-refund-payment-workflow';
/**
 * 환불 요청 워크 플로우
 */
export const requestRefundPaymentWorkFlow = createWorkflow(
  requestRefundPaymentWorkFlowId,
  (input: WorkflowData<RefundPaymentWorkflowInput>) => {
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

    // 환불 가능 여부 검증
    validateRefundStep({ order, payment, amount: input.amount });
    // 외부 시스템으로 환불 요청 전송
    requestRefundPaymentStep({ payment, input });

    return new WorkflowResponse(payment);
  },
);
