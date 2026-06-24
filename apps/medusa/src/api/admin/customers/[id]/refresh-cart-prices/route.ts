import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { refreshCartItemsWorkflow } from '@medusajs/medusa/core-flows';
import { fixCompareAtPrices } from '../../../../utils/cart-prices';

/**
 * 고객 카트 가격 재계산. 채널 어댑터가 멤버십 그룹 변경 후 fire-and-forget으로 호출.
 *
 * 카트는 아이템 추가 시점 가격이 lock-in → 그룹 바뀌어도 자동 갱신 안 됨.
 * 1) refreshCartItemsWorkflow로 unit_price 갱신
 * 2) fixCompareAtPrices로 compare_at_unit_price 보정 (코어가 안 해줘서 직접 처리)
 *
 * 최신 카트 1개만 처리.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id: customerId } = req.params;

  if (!customerId) {
    return res.status(400).json({ message: 'customerId is required' });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: [
      'id',
      'currency_code',
      'region_id',
      'customer_id',
      'customer.groups.id',
      'items.id',
      'items.variant_id',
      'items.unit_price',
      'items.compare_at_unit_price',
      'items.quantity',
      'updated_at',
    ],
    filters: {
      customer_id: customerId,
      completed_at: null,
    },
  });

  const activeCarts = (carts || [])
    .filter((cart: any) => cart.items?.length > 0)
    .sort((a: any, b: any) => {
      const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return dateB - dateA;
    })
    .slice(0, 1);

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
        input: { cart_id: cart.id, force_refresh: true },
      });
    } catch (error: any) {
      console.error(`[refresh-cart-prices] workflow failed for cart ${cart.id}:`, error?.message);
    }

    try {
      await fixCompareAtPrices(req.scope, cart);
      refreshedCartIds.push(cart.id);
    } catch (error: any) {
      console.error(`[refresh-cart-prices] fixCompareAtPrices failed for cart ${cart.id}:`, error?.message);
    }
  }

  return res.status(200).json({
    success: true,
    refreshed: refreshedCartIds.length > 0,
    refreshed_cart_ids: refreshedCartIds,
  });
}
