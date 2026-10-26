import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { handleReturnable } from '../../../../orders-returns/return-request-handlers';

/**
 * 고객 반품 가능 수량 조회(K8 PR3). 본인 주문이 아니면 404.
 * 응답 200 { items: [{ item_id, returnable_quantity, window_ends_at(ISO|null) }] } — core 의 배송완료 단위에서 Medusa 의 반품 점유를 뺀 값이다.
 * GET /store/orders/:id/returnable
 */
export const GET = (req: AuthenticatedMedusaRequest, res: MedusaResponse) => handleReturnable(req, res, 'store');
