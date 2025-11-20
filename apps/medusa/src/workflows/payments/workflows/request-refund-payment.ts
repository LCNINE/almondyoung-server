import {
  createWorkflow,
  transform,
  WorkflowData,
  WorkflowResponse,
} from '@medusajs/framework/workflows-sdk';
import {
  RefundPaymentWorkflowInput,
  useQueryGraphStep,
  useRemoteQueryStep,
  validatePaymentsRefundStep,
} from '@medusajs/medusa/core-flows';
import { requestRefundPaymentStep } from '../steps/request-refund-payment';

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

    const paymentsQuery = useQueryGraphStep({
      entity: 'payments',
      fields: [
        'id',
        'currency_code',
        'provider_id',
        'amount',
        'refunds.id',
        'refunds.amount',
        'captures.id',
        'captures.amount',
        'payment_collection.order.id',
        'payment_collection.order.currency_code',
      ],
      filters: { id: [input.payment_id] },
      options: { throwIfKeyNotFound: true },
    }).config({ name: 'get-payment' });

    const payments = transform(
      { paymentsQuery },
      ({ paymentsQuery }) => paymentsQuery.data,
    );

    // 환불 가능 여부 검증 (단일 payment를 배열로 감싸서 전달)
    validatePaymentsRefundStep({
      payments,
      input: transform({ input }, ({ input }) => [input]),
    });

    // 외부 시스템으로 환불 요청 전송
    requestRefundPaymentStep({ payment, input });

    return new WorkflowResponse(payment);
  },
);
