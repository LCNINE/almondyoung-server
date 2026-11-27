import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

import { listParentsForProduct } from '../handlers';

/** GET /store/add-to-delivery/parents?product_id= — 상품 상세 함께 받기 버튼의 부모 후보 */
export async function GET(req: AuthenticatedMedusaRequest<unknown, { product_id: string }>, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id;
  if (!customerId) return res.status(401).json({ message: 'Customer authentication required' });

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const parents = await listParentsForProduct(query, customerId, req.validatedQuery.product_id);

  return res.json({ parents });
}
