import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';

import { WALLET_REFUND_REFUSED_PREFIX } from '../../../../../../../modules/almond-payment/wallet-refund-refusal';
import {
  prepayOrderReturn,
  ReturnPrepayRefundPending,
  ReturnPrepayRefundRefused,
  ReturnPrepayRejected,
} from '../../../../../../../workflows/orders/returns/prepay-order-return';
import { ReturnOrderNotFound } from '../../../../../../../workflows/orders/returns/request-order-return';
import { parseInput } from './parse-input';

/**
 * 반품 선환불(K8 PR6b) — channel-adapter 가 core 의 PrepayChannelReturn 명령을 받아 부른다. 수령 없이 RETURN 환불만 낸다.
 * 본문 `{ requestId, amount?, refundMode?, memo }`. 응답 계약은 정산 라우트와 같은 모양이고 channel-adapter 가 읽는다:
 * 200 결과 · 404 not_found(없는 반품이거나 다른 주문의 반품) ·
 * 400 code=return_prepay_rejected + reason(not_our_return·return_canceled·return_already_settled·request_id_conflict·
 *   prepay_exceeds_item_value·external_refund_unresolved·pending_refund_outstanding) = 정해진 거절, 돈은 안 움직였다 ·
 * 400 code=wallet_refund_refused:<code> = wallet 이 환불을 영구 거절(같은 requestId 로 refundMode manual 로 다시) ·
 * 502 type=refund_pending = 환불이 남음(같은 requestId 로 재시도) ·
 * 그 밖은 그대로 던져 500(일시). 본문이 틀리면 Medusa 의 400 type=invalid_data 다 — 최종 거절은 code 로 가린다.
 * POST /admin/orders/:id/returns/:return_id/prepay
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { requestId, amount, refundMode, memo } = parseInput(req.body);
  try {
    const result = await prepayOrderReturn(req.scope, {
      orderId: req.params.id,
      returnId: req.params.return_id,
      requestId,
      ...(amount !== undefined ? { amount } : {}),
      ...(refundMode !== undefined ? { refundMode } : {}),
      memo,
      actorId: req.auth_context?.actor_id,
    });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ReturnOrderNotFound) {
      res.status(404).json({ type: 'not_found', message: error.message });
      return;
    }
    if (error instanceof ReturnPrepayRejected) {
      res.status(400).json({ type: 'not_allowed', code: 'return_prepay_rejected', reason: error.reason, message: error.message });
      return;
    }
    if (error instanceof ReturnPrepayRefundRefused) {
      res.status(400).json({
        type: 'not_allowed',
        code: `${WALLET_REFUND_REFUSED_PREFIX}${error.refusalCode}`,
        requestId: error.requestId,
        message: error.message,
      });
      return;
    }
    if (error instanceof ReturnPrepayRefundPending) {
      res.status(502).json({ type: 'refund_pending', requestId: error.requestId, message: error.message });
      return;
    }
    throw error;
  }
};
