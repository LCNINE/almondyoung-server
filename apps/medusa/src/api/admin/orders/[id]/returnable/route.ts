import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { handleReturnable } from '../../../../orders-returns/return-request-handlers';

/**
 * CS 반품 가능 수량 조회(K8 PR3). 응답은 store 와 같다.
 * 소유 확인 없음.
 * GET /admin/orders/:id/returnable
 */
export const GET = (req: AuthenticatedMedusaRequest, res: MedusaResponse) => handleReturnable(req, res, 'admin');
