import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';

export const REFUND_ON_CANCELED_ORDER_CODE = 'refund_on_canceled_order';

/**
 * 취소된 주문의 기본 환불을 막는다(#1016 36번 재설계 §6.6). 취소된 주문에 환불하면 돈이 «나간 뒤» 크레딧 라인 단계가
 * throwIfOrderIsCancelled 로 던지고 환불 단계엔 보상이 없다(스펙 §2.2). 결제 → 주문은 core-flows 의 refundPaymentWorkflow 와 같은
 * order_payment_collection 링크로 찾는다. 결제가 없으면 통과 — 라우트가 404 를 낸다.
 */
export async function rejectRefundOnCanceledOrder(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const [payment] = await req.scope
    .resolve(Modules.PAYMENT)
    .listPayments({ id: req.params.id }, { select: ['id', 'payment_collection_id'] });
  if (!payment) return next();
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order_payment_collection',
    fields: ['order.id', 'order.status'],
    filters: { payment_collection_id: payment.payment_collection_id },
  });
  // query.graph 의 링크 필드는 타입이 넓다 — 경계에서 상태 하나로만 좁힌다
  const status = (data[0] as { order?: { status?: string } | null } | undefined)?.order?.status;
  if (status === 'canceled') {
    return res.status(400).json({
      type: 'not_allowed',
      code: REFUND_ON_CANCELED_ORDER_CODE,
      message: '취소된 주문의 결제는 여기서 환불할 수 없습니다. admin-web 에서 처리하세요.',
    });
  }
  return next();
}
