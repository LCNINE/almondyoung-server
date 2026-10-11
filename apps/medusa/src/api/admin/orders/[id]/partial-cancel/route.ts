import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { WALLET_REFUND_REFUSED_PREFIX } from '../../../../../modules/almond-payment/wallet-refund-refusal';
import {
  partialCancelOrder,
  PartialCancelRefundPending,
  PartialCancelRefundRefused,
} from '../../../../../workflows/orders/partial-cancel/partial-cancel-order';
import { PartialCancelExternalRefundRejected } from '../../../../../workflows/orders/partial-cancel/external-refund';
import { PartialCancelRejected } from '../../../../../workflows/orders/partial-cancel/plan-partial-cancel';
import { parseInput } from './parse-input';

/**
 * 채널 주문 부분취소 (#1016 35번, ADR-0042). channel-adapter 가 core 의 CancelChannelOrder 명령을 받아 부른다.
 * 응답 계약은 channel-adapter 가 읽는다 — 400 code=partial_cancel_rejected = 정해진 거절, 502 refund_pending = 수정은 됐고 환불이 남음(재시도).
 * 400 에 `reason: external_refund_*` 가 붙으면 «이미 환불한 금액»을 묻는 거절(#1016 37번).
 * 400 code=wallet_refund_refused:<code> + stage edited = 수정은 확정됐고 wallet 이 환불을 영구 거절(#1016 36번 재설계). 같은 requestId 로 다시(또는 refundMode manual) 부르면 환불부터 이어 간다.
 * Medusa 자신의 NOT_ALLOWED(예: 다른 주문 수정이 열려 있음 — 일시적)도 400 type=not_allowed 로 나가므로, 최종 거절은
 * type 이 아니라 code 로 가린다.
 * 진행 기록 없는 확정 수정 등 그 밖의 오류는 그대로 던져 500 이 된다(호출자는 일시 오류로 보고 재시도).
 * POST /admin/orders/:id/partial-cancel
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { requestId, items, alreadyRefunded, refundMode } = parseInput(req.body);
  try {
    const result = await partialCancelOrder(req.scope, {
      orderId: req.params.id,
      requestId,
      items,
      ...(alreadyRefunded !== undefined ? { alreadyRefunded } : {}),
      ...(refundMode !== undefined ? { refundMode } : {}),
      actorId: req.auth_context?.actor_id,
    });
    res.status(200).json(result);
  } catch (error) {
    // 하위 클래스라 먼저 본다 — code 는 그대로 두고 사유·금액만 더한다(옛 channel-adapter 는 그냥 거절로 닫는다)
    if (error instanceof PartialCancelExternalRefundRejected) {
      res.status(400).json({
        type: 'not_allowed',
        code: 'partial_cancel_rejected',
        reason: error.reason,
        unresolvedAmount: error.unresolvedAmount,
        message: error.message,
      });
      return;
    }
    if (error instanceof PartialCancelRejected) {
      res.status(400).json({ type: 'not_allowed', code: 'partial_cancel_rejected', message: error.message });
      return;
    }
    if (error instanceof PartialCancelRefundRefused) {
      // 표지는 전체취소(channel-cancel)와 같다. 수정은 확정된 채라 의무는 장부의 음수 차액에 남는다
      res.status(400).json({
        type: 'not_allowed',
        code: `${WALLET_REFUND_REFUSED_PREFIX}${error.refusalCode}`,
        stage: 'edited',
        requestId: error.requestId,
        message: error.message,
      });
      return;
    }
    if (error instanceof PartialCancelRefundPending) {
      res.status(502).json({ type: 'refund_pending', stage: 'edited', requestId: error.requestId, message: error.message });
      return;
    }
    throw error;
  }
};
