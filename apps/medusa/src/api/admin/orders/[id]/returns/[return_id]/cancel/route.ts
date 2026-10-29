import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { handleReturnCancel } from '../../../../../../orders-returns/return-request-handlers';

/**
 * 도착 전 반품 취소(K8 PR3) — CS 가 admin-web 에서 부른다. 본문 없음.
 * 200 { return_id, status: 'canceled' } / 400 code=return_rejected reason=return_already_received·return_arrived·return_picked_up·not_our_return / 404. POST /admin/orders/:id/returns/:return_id/cancel
 */
export const POST = (req: AuthenticatedMedusaRequest, res: MedusaResponse) => handleReturnCancel(req, res, 'admin');
