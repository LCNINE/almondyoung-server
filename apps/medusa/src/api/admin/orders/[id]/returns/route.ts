import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { handleReturnRequest } from '../../../../orders-returns/return-request-handlers';

/**
 * CS 반품 요청(K8 PR3). admin-web 이 부른다. 기한을 넘기려면 window_override_reason, 사유 'other' 면 fee_bearer 가 필요하다.
 * 본문 { request_id, items, reason, note?, fee_bearer?, window_override_reason? }. 소유 확인 없음(CS 는 모든 주문).
 * fee_bearer 는 사유 'other'(기타 — 부담 주체를 CS 가 정하는 사유)에만 쓰인다. 다른 사유는 사유 표가 부담 주체를 정해 두어 보낸 값을 버린다.
 * 응답은 store 와 같다 — 같은 request_id 재전송은 그때 결과를 돌려주고, 그 반품이 그 사이 취소됐으면 200 이 status: 'canceled' 를 싣는다.
 * POST /admin/orders/:id/returns
 */
export const POST = (req: AuthenticatedMedusaRequest, res: MedusaResponse) => handleReturnRequest(req, res, 'admin');
