import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';

import { cancelOrderReturn } from '../../workflows/orders/returns/cancel-order-return';
import { fetchCoreReturnEligibility } from '../../workflows/orders/returns/core-return-eligibility';
import { describeStoreReturns } from '../../workflows/orders/returns/describe-store-returns';
import { loadReturnOrder } from '../../workflows/orders/returns/load-return-order';
import { loadStoreReturns } from '../../workflows/orders/returns/load-store-returns';
import { describeOrderReturnable } from '../../workflows/orders/returns/plan-return-request';
import {
  requestOrderReturn,
  ReturnOrderNotFound,
  type RequestOrderReturnResult,
} from '../../workflows/orders/returns/request-order-return';
import { parseReturnRequestBody } from './parse-return-input';
import { sendReturnError } from './return-error-response';

const toBody = (r: RequestOrderReturnResult) => ({
  return_id: r.returnId,
  request_id: r.requestId,
  status: r.status,
  items: r.items.map((i) => ({ item_id: i.itemId, quantity: i.quantity })),
  fee_bearer: r.feeBearer,
  window_overridden: r.windowOverridden,
  kind: r.kind,
});

/** store·admin POST 가 공유한다 — 다른 건 호출 주체뿐이다. 고객 소유 확인은 requestOrderReturn 안에서 한다. */
export async function handleReturnRequest(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
  scope: 'store' | 'admin',
) {
  const input = parseReturnRequestBody(req.body, scope);
  const actorId = req.auth_context?.actor_id;
  try {
    const result = await requestOrderReturn(req.scope, {
      ...input,
      orderId: req.params.id,
      ...(scope === 'store'
        ? { requestedBy: 'customer' as const, customerId: actorId }
        : { requestedBy: 'operator' as const, actorId }),
    });
    res.status(200).json(toBody(result));
  } catch (error) {
    if (!sendReturnError(res, error)) throw error;
  }
}

/** store·admin GET 이 공유한다. store 는 본인 주문이 아니면 404 — 존재 여부를 흘리지 않는다. */
export async function handleReturnable(req: AuthenticatedMedusaRequest, res: MedusaResponse, scope: 'store' | 'admin') {
  try {
    const order = await loadReturnOrder(req.scope, req.params.id);
    if (
      !order ||
      (scope === 'store' && (!req.auth_context?.actor_id || order.customerId !== req.auth_context.actor_id))
    ) {
      throw new ReturnOrderNotFound(`주문을 찾을 수 없습니다: ${req.params.id}`);
    }
    // 취소된 주문은 POST 가 order_canceled 로 거절한다 — GET 도 같은 판정으로 전 줄 0 을 낸다(화면이 규칙을 다시 만들지 않게)
    const lines = await describeOrderReturnable(order.status, order.items, () => fetchCoreReturnEligibility(order.id));
    res.status(200).json({
      items: lines.map((l) => ({
        item_id: l.itemId,
        returnable_quantity: l.returnableQuantity,
        window_ends_at: l.windowEndsAt ? l.windowEndsAt.toISOString() : null,
        exchangeable: l.exchangeable,
      })),
    });
  } catch (error) {
    if (!sendReturnError(res, error)) throw error;
  }
}

/** store·admin 반품 취소가 공유한다. 본문 없음 — 고객 소유 확인은 cancelOrderReturn 안에서 한다. */
export async function handleReturnCancel(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
  scope: 'store' | 'admin',
) {
  const actorId = req.auth_context?.actor_id;
  try {
    const result = await cancelOrderReturn(req.scope, {
      orderId: req.params.id,
      returnId: req.params.return_id,
      ...(scope === 'store'
        ? { requestedBy: 'customer' as const, customerId: actorId }
        : { requestedBy: 'operator' as const, actorId }),
    });
    res.status(200).json({ return_id: result.returnId, status: result.status });
  } catch (error) {
    if (!sendReturnError(res, error)) throw error;
  }
}

/** 고객 본인 주문의 반품 목록(K8 PR8 N2). 본인 주문이 아니면 404 — 존재 여부를 흘리지 않는다. */
export async function handleStoreReturnList(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const actorId = req.auth_context?.actor_id;
    const order = await loadStoreReturns(req.scope, req.params.id);
    if (!order || !actorId || order.customerId !== actorId) {
      throw new ReturnOrderNotFound(`주문을 찾을 수 없습니다: ${req.params.id}`);
    }
    res.status(200).json({
      returns: describeStoreReturns(order.returns).map((r) => ({
        return_id: r.returnId,
        stage: r.stage,
        requested_at: r.requestedAt,
        reason: r.reason,
        fee_bearer: r.feeBearer,
        items: r.items.map((i) => ({ item_id: i.itemId, quantity: i.quantity })),
        can_cancel: r.canCancel,
        kind: r.kind,
        refund: r.refund && {
          kind: r.refund.kind,
          item_total: r.refund.itemTotal,
          shipping_refund: r.refund.shippingRefund,
          fees: r.refund.fees,
          total: r.refund.total,
          received_at: r.refund.receivedAt,
          refunded_at: r.refund.refundedAt,
        },
      })),
    });
  } catch (error) {
    if (!sendReturnError(res, error)) throw error;
  }
}
