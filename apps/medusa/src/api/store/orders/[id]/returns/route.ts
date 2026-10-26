import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { handleReturnRequest } from '../../../../orders-returns/return-request-handlers';

/**
 * 고객 반품 요청(K8 PR3). 쇼핑몰이 로그인한 고객으로 부른다(미들웨어 authenticate customer).
 * 본문 { request_id, items: [{ item_id, quantity }], reason, note? } — fee_bearer·window_override_reason 은 400. 남의 주문·없는 주문은 404.
 * 응답 200 { return_id, request_id, status, items, fee_bearer, window_overridden } / 400 code=return_request_rejected + reason / 502 core_unavailable. POST /store/orders/:id/returns
 */
export const POST = (req: AuthenticatedMedusaRequest, res: MedusaResponse) => handleReturnRequest(req, res, 'store');
