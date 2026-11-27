import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

import { readLinks } from '../handlers';

/** GET /store/add-to-delivery/links?order_ids=a,b — 마이페이지 함께 배송 묶음과 금액 */
export async function GET(req: AuthenticatedMedusaRequest<unknown, { order_ids: string[] }>, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id;
  if (!customerId) return res.status(401).json({ message: 'Customer authentication required' });

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const links = await readLinks({ query, knex }, customerId, req.validatedQuery.order_ids);

  return res.json({ links });
}
