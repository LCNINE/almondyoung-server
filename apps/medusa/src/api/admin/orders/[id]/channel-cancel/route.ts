import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { channelCancelOrder } from '../../../../../workflows/orders/channel-cancel/channel-cancel-order';

/**
 * 채널 주문 전체취소 (#1016 36번 스펙 §4.6). channel-adapter 가 core 의 CancelChannelOrder 명령을 받아 부른다.
 * 기본 POST /admin/orders/:id/cancel 의 «복제» — 기본 라우트는 환불 오류를 삼켜 환불 없이 취소하므로 쓰지 않는다(그건 그대로 둔다).
 * 응답 계약: 200 { orderId, status } · 404 not_found · 400 «Order with id … has been canceled.»(이미 취소됨) ·
 * 400 not_allowed + code wallet_refund_<kind>:<walletCode>(환불 거절, 주문은 안 취소됨) ·
 * 그 밖 400 은 환불 전 사전 검사뿐(진행 중인 주문 변경·안 취소된 출고) · 500(일시 실패, 재시도 — 환불 뒤의 실패는 전부 여기로).
 * 오류는 잡지 않는다 — Medusa 에러 핸들러가 MedusaError 의 type 으로 상태를, code 를 그대로 본문에 싣는다.
 * POST /admin/orders/:id/channel-cancel
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  await channelCancelOrder(req.scope, { orderId: req.params.id, actorId: req.auth_context?.actor_id });
  res.status(200).json({ orderId: req.params.id, status: 'canceled' });
};
