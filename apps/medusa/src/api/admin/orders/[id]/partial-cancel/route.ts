import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { partialCancelOrder, PartialCancelRefundPending } from '../../../../../workflows/orders/partial-cancel/partial-cancel-order';
import { PartialCancelExternalRefundRejected } from '../../../../../workflows/orders/partial-cancel/external-refund';
import { PartialCancelRejected } from '../../../../../workflows/orders/partial-cancel/plan-partial-cancel';
import { parseInput } from './parse-input';

/**
 * 채널 주문 부분취소 (#1016 35번, ADR-0042). channel-adapter 가 core 의 CancelChannelOrder 명령을 받아 부른다.
 * 응답 계약은 channel-adapter 가 읽는다 — 400 code=partial_cancel_rejected = 정해진 거절, 502 refund_pending = 수정은 됐고 환불이 남음(재시도). 원인이 wallet 영구 거절이면 본문에 `refundFailure` 가 붙는다(#1016 36번).
 * 400 에 `reason: external_refund_*` 가 붙으면 «이미 환불한 금액»을 묻는 거절(#1016 37번).
 * Medusa 자신의 NOT_ALLOWED(예: 다른 주문 수정이 열려 있음 — 일시적)도 400 type=not_allowed 로 나가므로, 최종 거절은
 * type 이 아니라 code 로 가린다.
 * 진행 기록 없는 확정 수정 등 그 밖의 오류는 그대로 던져 500 이 된다(호출자는 일시 오류로 보고 재시도).
 * POST /admin/orders/:id/partial-cancel
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { requestId, items, alreadyRefunded } = parseInput(req.body);
  try {
    const result = await partialCancelOrder(req.scope, {
      orderId: req.params.id,
      requestId,
      items,
      ...(alreadyRefunded !== undefined ? { alreadyRefunded } : {}),
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
    if (error instanceof PartialCancelRefundPending) {
      res.status(502).json({
        type: 'refund_pending',
        stage: 'edited',
        requestId: error.requestId,
        message: error.message,
        ...(error.refundFailure ? { refundFailure: error.refundFailure } : {}),
      });
      return;
    }
    throw error;
  }
};
