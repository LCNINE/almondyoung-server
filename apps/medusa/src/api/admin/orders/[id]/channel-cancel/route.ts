import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { channelCancelOrder } from '../../../../../workflows/orders/channel-cancel/channel-cancel-order';
import { parseRefundMode } from '../../../../../workflows/orders/settlement/refund-mode';

/**
 * 채널 주문 전체취소 정산 (#1016 36번 재설계 스펙 §6.1). channel-adapter 가 core 의 CancelChannelOrder 명령을 받아 부른다(PR 3).
 * 기본 POST /admin/orders/:id/cancel 의 «복제» — 기본 라우트는 환불 오류를 삼켜 환불 없이 취소하므로 쓰지 않는다(그건 그대로 둔다).
 * 본문 `{ refundMode?: 'auto' | 'manual' }`(없으면 auto).
 * 응답: 200 `{ orderId, status: 'canceled', refund: { mode, amount } }` · 404 not_found ·
 * 400 «Order with id … has been canceled.»(이미 취소됨 — 성공으로 읽는다) ·
 * 400 not_allowed + code `wallet_refund_refused:<code>`(영구 거절, 주문은 안 취소됨) ·
 * 그 밖 400 은 환불 전 사전 검사(진행 중인 주문 변경·안 취소된 출고)와 본문 오류(invalid_data) ·
 * 500 일시 실패 — 환불 뒤 단계의 실패도 여기로, 다시 부르면 남은 몫만 환불한다.
 * 오류는 잡지 않는다 — Medusa 에러 핸들러가 MedusaError 의 type 으로 상태를, code 를 그대로 본문에 싣는다.
 */
export const POST = async (req: AuthenticatedMedusaRequest<{ refundMode?: unknown }>, res: MedusaResponse) => {
  const refundMode = parseRefundMode(req.body?.refundMode);
  const result = await channelCancelOrder(req.scope, { orderId: req.params.id, refundMode, actorId: req.auth_context?.actor_id });
  res.status(200).json(result);
};
