import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { refreshCartItemsWorkflow } from '@medusajs/medusa/core-flows';

/**
 * POST /admin/customers/:customerId/refresh-cart-prices
 *
 * 고객의 활성 카트 라인 아이템 가격 재계산
 * 멤버십 그룹 변경 후 Price List 기반 가격 반영
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { customerId } = req.params;

  if (!customerId) {
    return res.status(400).json({ message: 'customerId is required' });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: ['id', 'items.id'],
    filters: {
      customer_id: customerId,
      completed_at: null,
    },
  });

  const activeCarts = (carts || []).filter((cart: any) => cart.items?.length > 0);

  if (activeCarts.length === 0) {
    return res.status(200).json({
      success: true,
      refreshed: false,
      message: 'No active cart with items found for this customer',
    });
  }

  const refreshedCartIds: string[] = [];

  for (const cart of activeCarts) {
    try {
      await refreshCartItemsWorkflow(req.scope).run({
        input: {
          cart_id: cart.id,
          force_refresh: true,
        },
      });
      refreshedCartIds.push(cart.id);
    } catch (error: any) {
      console.error(`[refresh-cart-prices] Failed to refresh cart ${cart.id}:`, error?.message);
    }
  }

  return res.status(200).json({
    success: true,
    refreshed: refreshedCartIds.length > 0,
    refreshed_cart_ids: refreshedCartIds,
  });
}
