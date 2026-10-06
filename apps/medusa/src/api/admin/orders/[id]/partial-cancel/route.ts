import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { partialCancelOrder, PartialCancelRefundPending } from '../../../../../workflows/orders/partial-cancel/partial-cancel-order';
import { PartialCancelRejected } from '../../../../../workflows/orders/partial-cancel/plan-partial-cancel';
import { parseInput } from './parse-input';

/**
 * 채널 주문 부분취소 (#1016 35번, ADR-0042). channel-adapter 가 core 의 CancelChannelOrder 명령을 받아 부른다.
 * 응답 계약은 channel-adapter 가 읽는다 — 400 not_allowed = 정해진 거절, 502 refund_pending = 수정은 됐고 환불이 남음(재시도).
 * 진행 기록 없는 확정 수정 등 그 밖의 오류는 그대로 던져 500 이 된다(호출자는 일시 오류로 보고 재시도).
 * POST /admin/orders/:id/partial-cancel
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { requestId, items } = parseInput(req.body);
  try {
    const result = await partialCancelOrder(req.scope, {
      orderId: req.params.id,
      requestId,
      items,
      actorId: req.auth_context?.actor_id,
    });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof PartialCancelRejected) {
      res.status(400).json({ type: 'not_allowed', message: error.message });
      return;
    }
    if (error instanceof PartialCancelRefundPending) {
      res.status(502).json({ type: 'refund_pending', stage: 'edited', requestId: error.requestId, message: error.message });
      return;
    }
    throw error;
  }
};
