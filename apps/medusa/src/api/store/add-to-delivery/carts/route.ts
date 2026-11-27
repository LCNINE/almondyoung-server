import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { createCartWorkflow } from '@medusajs/medusa/core-flows';

import { startAddToDeliveryCart, type CreateCartInput } from '../handlers';

/** POST /store/add-to-delivery/carts — 부모 배송지를 복사한 함께 배송 카트 */
export async function POST(
  req: AuthenticatedMedusaRequest<{ parent_order_id: string; variant_id: string }>,
  res: MedusaResponse,
) {
  const customerId = req.auth_context?.actor_id;
  if (!customerId) return res.status(401).json({ message: 'Customer authentication required' });

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const createCart = async (input: CreateCartInput) => {
    const { result } = await createCartWorkflow(req.scope).run({ input });

    return { id: result.id };
  };

  return res.json(await startAddToDeliveryCart({ query, createCart }, customerId, req.validatedBody));
}
