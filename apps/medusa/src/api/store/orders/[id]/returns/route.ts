import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { handleReturnRequest } from '../../../../orders-returns/return-request-handlers';

/**
 * 고객 반품 요청(K8 PR3). 쇼핑몰이 로그인한 고객으로 부른다(미들웨어 authenticate customer).
 * 본문 { request_id, items: [{ item_id, quantity }], reason, note? } — fee_bearer·window_override_reason 은 400. 남의 주문·없는 주문은 404.
 * 응답 200 { return_id, request_id, status, items, fee_bearer, window_overridden } / 400 code=return_rejected + reason / 502 core_unavailable. POST /store/orders/:id/returns
 * 같은 request_id 를 다시 보내면 새로 만들지 않고 그때 결과를 돌려준다 — 그 반품이 그 사이 취소됐으면 200 이 status: 'canceled' 를 싣는다.
 * 화면은 200 을 «접수됨»으로 읽지 말고 status 를 볼 것. 다시 반품하려면 새 request_id 로 보낸다.
 */
export const POST = (req: AuthenticatedMedusaRequest, res: MedusaResponse) => handleReturnRequest(req, res, 'store');
