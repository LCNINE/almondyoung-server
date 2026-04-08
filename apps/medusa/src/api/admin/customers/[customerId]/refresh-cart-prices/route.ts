import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { refreshCartItemsWorkflow } from '@medusajs/medusa/core-flows';

/**
 * POST /admin/customers/:customerId/refresh-cart-prices
 *
 * 고객의 활성 카트 라인 아이템 가격 재계산
 * 멤버십 그룹 변경 후 Price List 기반 가격 반영
 *
 * compare_at_unit_price를 직접 보정(unit_price만 갱신돼서)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { customerId } = req.params;

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
    ],
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

      await fixCompareAtPrices(req.scope, cart);

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

/**
 * compare_at_unit_price를 직접 보정
 */
async function fixCompareAtPrices(scope: any, cart: any): Promise<void> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);
  const pricingModule = scope.resolve(Modules.PRICING);
  const cartModule = scope.resolve(Modules.CART);

  const { data: refreshedCarts } = await query.graph({
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
    ],
    filters: { id: cart.id },
  });

  const refreshedCart = refreshedCarts?.[0];
  if (!refreshedCart?.items?.length) return;

  const variantIds = refreshedCart.items
    .map((item: any) => item.variant_id)
    .filter(Boolean);

  if (variantIds.length === 0) return;

  const { data: variantPriceSets } = await query.graph({
    entity: 'variant',
    fields: ['id', 'price_set.id'],
    filters: { id: variantIds },
  });

  const variantToPriceSetId = new Map<string, string>();
  for (const v of variantPriceSets) {
    if (v.price_set?.id) {
      variantToPriceSetId.set(v.id, v.price_set.id);
    }
  }

  const pricingContext = {
    currency_code: refreshedCart.currency_code,
    region_id: refreshedCart.region_id,
    customer_id: refreshedCart.customer_id,
    customer: refreshedCart.customer,
  };

  const priceSetIds = [...new Set(variantToPriceSetId.values())];
  if (priceSetIds.length === 0) return;

  const calculatedPrices = await pricingModule.calculatePrices(
    { id: priceSetIds },
    { context: pricingContext },
  );

  const priceSetToResult = new Map<string, any>();
  for (const cp of calculatedPrices) {
    priceSetToResult.set(cp.id, cp);
  }

  const updates: Array<{ id: string; compare_at_unit_price: number | null }> = [];

  for (const item of refreshedCart.items) {
    const priceSetId = variantToPriceSetId.get(item.variant_id);
    if (!priceSetId) continue;

    const pricing = priceSetToResult.get(priceSetId);
    if (!pricing) continue;

    const isSalePrice = pricing.calculated_price?.price_list_type === 'sale';
    const originalAmount = pricing.original_amount != null ? Number(pricing.original_amount) : null;
    const calculatedAmount = pricing.calculated_amount != null ? Number(pricing.calculated_amount) : null;

    if (isSalePrice && originalAmount != null && calculatedAmount != null && originalAmount !== calculatedAmount) {
      if (item.compare_at_unit_price == null || Number(item.compare_at_unit_price) !== originalAmount) {
        updates.push({ id: item.id, compare_at_unit_price: originalAmount });
      }
    } else if (!isSalePrice && item.compare_at_unit_price != null) {
      updates.push({ id: item.id, compare_at_unit_price: null });
    }
  }

  if (updates.length > 0) {
    await cartModule.updateLineItems(updates);
  }
}
