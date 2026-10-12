import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { Modules } from '@medusajs/framework/utils';
import { orderPaymentIds } from '../../../../workflows/orders/settlement/order-payments';
import { toNumber } from '../../../../workflows/orders/partial-cancel/amount';

export const DEFAULT_CANCEL_BLOCKED_CODE = 'default_cancel_blocked';

/**
 * 대시보드 기본 취소를 막는다(#1016 36번 재설계 §6.6). 2.13.4 의 cancelOrderWorkflow 는 환불 실패를 삼키고 환불 거래를 입력 전체로 적어
 * 장부를 거짓으로 만든다(스펙 §2.2) — 돌려줄 돈이 남은 주문은 admin-web(정산 라우트 channel-cancel)으로만 취소한다.
 * 정산 라우트는 워크플로를 직접 부르므로 이 미들웨어를 지나지 않는다. 금액을 읽을 수 없으면 막는다(E6).
 */
export async function rejectDefaultCancelWithRefundable(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const payments = req.scope.resolve(Modules.PAYMENT);
  for (const paymentId of await orderPaymentIds(req.scope, req.params.id)) {
    const p = await payments.retrievePayment(paymentId, { relations: ['captures', 'refunds'] });
    if (p.canceled_at) continue;
    const captured = (p.captures ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
    const refunded = (p.refunds ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
    if (!(captured - refunded <= 0)) {
      return res.status(400).json({
        type: 'not_allowed',
        code: DEFAULT_CANCEL_BLOCKED_CODE,
        message: '환불할 금액이 남은 주문은 여기서 취소할 수 없습니다. admin-web 에서 취소하세요.',
      });
    }
  }
  return next();
}
