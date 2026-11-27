import { OrderWorkflowEvents, PaymentCollectionStatus } from '@medusajs/framework/utils';
import { createWorkflow, transform, when, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import {
  cancelOrdersStep,
  cancelPaymentStep,
  cancelValidateOrder,
  deleteReservationsByLineItemsStep,
  emitEventStep,
  updatePaymentCollectionStep,
  useQueryGraphStep,
} from '@medusajs/medusa/core-flows';

/**
 * 함께 배송 보류가 걸린 부모의 취소. 기본 cancelOrderWorkflow 에서 «캡처 − 환불 전부 환불»과 그 크레딧 라인만 뺐다 —
 * 보류액은 함께 배송 주문이 나가거나 취소될 때까지 결제에 남는다. 나머지 단계(검증·예약 해제·미캡처 결제 취소·이벤트·컬렉션 취소·주문 취소)는 같다.
 */
export const cancelOrderKeepingHoldWorkflow = createWorkflow(
  'cancel-order-keeping-add-to-delivery-hold',
  (input: { order_id: string; canceled_by?: string }) => {
    const orderQuery = useQueryGraphStep({
      entity: 'order',
      fields: [
        'id',
        'status',
        'items.id',
        'fulfillments.canceled_at',
        'payment_collections.id',
        'payment_collections.payments.id',
        'payment_collections.payments.captures.id',
      ],
      filters: { id: input.order_id },
      options: { throwIfKeyNotFound: true },
    }).config({ name: 'get-order' });
    const order = transform({ orderQuery }, ({ orderQuery }) => orderQuery.data[0]);

    cancelValidateOrder({ order, input });

    const lineItemIds = transform({ order }, ({ order }) => (order.items ?? []).map((i: { id: string }) => i.id));
    const uncapturedPaymentIds = transform({ order }, ({ order }) =>
      (order.payment_collections ?? [])
        .flatMap((pc: { payments?: Array<{ id: string; captures?: unknown[] }> }) => pc.payments ?? [])
        .filter((p: { captures?: unknown[] }) => (p.captures ?? []).length === 0)
        .map((p: { id: string }) => p.id),
    );
    const paymentCollectionIds = transform({ order }, ({ order }) =>
      (order.payment_collections ?? []).map((pc: { id: string }) => pc.id),
    );

    deleteReservationsByLineItemsStep(lineItemIds);
    cancelPaymentStep({ paymentIds: uncapturedPaymentIds });
    emitEventStep({ eventName: OrderWorkflowEvents.CANCELED, data: { id: input.order_id } });

    when({ paymentCollectionIds }, ({ paymentCollectionIds }) => paymentCollectionIds.length > 0).then(() => {
      updatePaymentCollectionStep({
        selector: { id: paymentCollectionIds },
        update: { status: PaymentCollectionStatus.CANCELED },
      });
    });

    cancelOrdersStep({ orderIds: [input.order_id] });

    return new WorkflowResponse(undefined);
  },
);
