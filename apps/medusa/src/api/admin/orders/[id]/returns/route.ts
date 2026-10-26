import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { handleReturnRequest } from '../../../../orders-returns/return-request-handlers';

/**
 * CS 반품 요청(K8 PR3). admin-web 이 부른다. 기한을 넘기려면 window_override_reason, 사유 'other' 면 fee_bearer 가 필요하다.
 * 본문 { request_id, items, reason, note?, fee_bearer?, window_override_reason? }. 소유 확인 없음(CS 는 모든 주문).
 * 응답은 store 와 같다. POST /admin/orders/:id/returns
 */
export const POST = (req: AuthenticatedMedusaRequest, res: MedusaResponse) => handleReturnRequest(req, res, 'admin');
