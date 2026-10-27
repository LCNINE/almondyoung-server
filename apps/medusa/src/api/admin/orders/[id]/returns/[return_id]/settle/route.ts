import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';

import { WALLET_REFUND_REFUSED_PREFIX } from '../../../../../../../modules/almond-payment/wallet-refund-refusal';
import { ReturnOrderNotFound } from '../../../../../../../workflows/orders/returns/request-order-return';
import {
  ReturnSettleRefundPending,
  ReturnSettleRefundRefused,
  ReturnSettleRejected,
  settleOrderReturn,
} from '../../../../../../../workflows/orders/returns/settle-order-return';
import { parseInput } from './parse-input';

/**
 * 반품 정산(K8 PR6) — channel-adapter 가 core 의 SettleChannelReturn 명령을 받아 부른다.
 * 본문 `{ requestId, items: [{ item_id, received, dismissed }], refundMode?, hold_deduction?: { amount, memo }, already_refunded_amount?, closes_missing? }`
 * (뒤의 셋은 K8 PR6b — CS 의 보류 차감·이미 환불한 외부 환불·미도착 닫기). 응답 계약은 부분취소와 같은 모양이고 channel-adapter 가 읽는다:
 * 200 결과 · 404 not_found(없는 반품이거나 다른 주문의 반품) ·
 * 400 code=return_settle_rejected + reason(not_our_return·return_canceled·request_id_conflict·items_mismatch·external_refund_unresolved·
 * external_refund_exceeds·external_refund_absent·return_already_received) = 정해진 거절 ·
 * 400 code=wallet_refund_refused:<code> + stage received = 수령은 확정됐고 wallet 이 환불을 영구 거절(같은 requestId 로 다시, 또는 refundMode manual) ·
 * 502 type=refund_pending + stage received = 수령은 확정됐고 환불이 남음(재시도) ·
 * 그 밖은 그대로 던져 500(일시). Medusa 자신의 NOT_ALLOWED 도 400 type=not_allowed 로 나가므로 최종 거절은 code 로 가린다.
 * POST /admin/orders/:id/returns/:return_id/settle
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { requestId, items, refundMode, holdDeduction, alreadyRefundedAmount, closesMissing } = parseInput(req.body);
  try {
    const result = await settleOrderReturn(req.scope, {
      orderId: req.params.id,
      returnId: req.params.return_id,
      requestId,
      items,
      ...(refundMode !== undefined ? { refundMode } : {}),
      ...(holdDeduction ? { holdDeduction } : {}),
      ...(alreadyRefundedAmount !== undefined ? { alreadyRefundedAmount } : {}),
      ...(closesMissing ? { closesMissing } : {}),
      actorId: req.auth_context?.actor_id,
    });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ReturnOrderNotFound) {
      res.status(404).json({ type: 'not_found', message: error.message });
      return;
    }
    if (error instanceof ReturnSettleRejected) {
      res.status(400).json({ type: 'not_allowed', code: 'return_settle_rejected', reason: error.reason, message: error.message });
      return;
    }
    if (error instanceof ReturnSettleRefundRefused) {
      res.status(400).json({
        type: 'not_allowed',
        code: `${WALLET_REFUND_REFUSED_PREFIX}${error.refusalCode}`,
        stage: 'received',
        requestId: error.requestId,
        message: error.message,
      });
      return;
    }
    if (error instanceof ReturnSettleRefundPending) {
      res.status(502).json({ type: 'refund_pending', stage: 'received', requestId: error.requestId, message: error.message });
      return;
    }
    throw error;
  }
};
