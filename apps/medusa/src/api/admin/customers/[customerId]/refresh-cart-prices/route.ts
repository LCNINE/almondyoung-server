import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { refreshCartItemsWorkflow } from '@medusajs/medusa/core-flows';

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
 * compare_at_unit_price 보정.
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

  const updates: Array<{ id: string; unit_price?: number; compare_at_unit_price?: number | null }> = [];

  for (const item of refreshedCart.items) {
    const priceSetId = variantToPriceSetId.get(item.variant_id);
    if (!priceSetId) continue;

    const pricing = priceSetToResult.get(priceSetId);
    if (!pricing) continue;

    const isSalePrice = pricing.calculated_price?.price_list_type === 'sale';
    const originalAmount = pricing.original_amount != null ? Number(pricing.original_amount) : null;
    const calculatedAmount = pricing.calculated_amount != null ? Number(pricing.calculated_amount) : null;

    if (calculatedAmount == null) continue;

    const update: { id: string; unit_price?: number; compare_at_unit_price?: number | null } = { id: item.id };

    const currentUnitPrice = typeof item.unit_price === 'number' ? item.unit_price : null;
    if (currentUnitPrice !== calculatedAmount) {
      update.unit_price = calculatedAmount;
    }

    const currentCompareAt = item.compare_at_unit_price != null ? Number(item.compare_at_unit_price) : null;
    if (isSalePrice && originalAmount != null && originalAmount !== calculatedAmount) {
      if (currentCompareAt !== originalAmount) {
        update.compare_at_unit_price = originalAmount;
      }
    } else if (!isSalePrice && currentCompareAt != null) {
      update.compare_at_unit_price = null;
    }

    if (update.unit_price !== undefined || 'compare_at_unit_price' in update) {
      updates.push(update);
    }
  }

  if (updates.length > 0) {
    await cartModule.updateLineItems(updates);
  }
}
