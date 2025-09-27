import {
  createWorkflow,
  transform,
  WorkflowData,
  WorkflowResponse,
} from '@medusajs/framework/workflows-sdk';
import {
  RefundPaymentsWorkflowInput,
  useQueryGraphStep,
  validatePaymentsRefundStep,
} from '@medusajs/medusa/core-flows';
import { requestRefundPaymentsStep } from '../steps/request-refund-payments';

export const requestRefundPaymentsWorkflowId = 'request-refund-payments';
/**
 * 환불 요청 워크 플로우
 */
export const requestRefundPaymentsWorkflow = createWorkflow(
  requestRefundPaymentsWorkflowId,
  (input: WorkflowData<RefundPaymentsWorkflowInput>) => {
    const paymentIds = transform({ input }, ({ input }) =>
      input.map((paymentInput) => paymentInput.payment_id),
    );

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
      filters: { id: paymentIds },
      options: { throwIfKeyNotFound: true },
    }).config({ name: 'get-payments' });

    // 위의 paymentsQuery.fields값들이 들어옴
    const payments = transform(
      { paymentsQuery },
      ({ paymentsQuery }) => paymentsQuery.data,
    );

    // 환불 가능 여부 검증
    validatePaymentsRefundStep({ payments, input });

    // 외부 시스템으로 환불 요청 전송
    const refundResult = requestRefundPaymentsStep({ payments, input });

    return new WorkflowResponse(refundResult);
  },
);
