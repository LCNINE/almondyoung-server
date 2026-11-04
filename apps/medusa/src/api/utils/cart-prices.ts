import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';

export async function fixCompareAtPrices(
  scope: any,
  cart: { id: string; items?: Array<{ variant_id?: string }> },
): Promise<void> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);
  const pricingModule = scope.resolve(Modules.PRICING);
  const cartModule = scope.resolve(Modules.CART);

  const originalVariantIds = (cart.items ?? [])
    .map((item: any) => item.variant_id)
    .filter(Boolean) as string[];

  if (originalVariantIds.length === 0) return;

  const [{ data: refreshedCarts }, { data: variantPriceSets }] = await Promise.all([
    query.graph({
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
        'items.is_custom_price',
      ],
      filters: { id: cart.id },
    }),
    query.graph({
      entity: 'variant',
      fields: ['id', 'price_set.id'],
      filters: { id: originalVariantIds },
    }),
  ]);

  const refreshedCart = refreshedCarts?.[0];
  if (!refreshedCart?.items?.length) return;

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

  // 수량 할인은 price.min_quantity 로 걸러지므로 컨텍스트에 라인 수량이 있어야 한다. 없으면 수량가 라인이
  // 정가로 되돌아간다. 수량은 라인마다 다르니 수량별로 묶어 조회한다.
  const priceSetsByQuantity = new Map<number, Set<string>>();
  for (const item of refreshedCart.items) {
    if (item.is_custom_price) continue;
    const priceSetId = variantToPriceSetId.get(item.variant_id);
    const quantity = Number(item.quantity);
    if (!priceSetId || !Number.isFinite(quantity) || quantity <= 0) continue;
    const bucket = priceSetsByQuantity.get(quantity) ?? new Set<string>();
    bucket.add(priceSetId);
    priceSetsByQuantity.set(quantity, bucket);
  }
  if (priceSetsByQuantity.size === 0) return;

  const priceSetToResult = new Map<string, any>();
  for (const [quantity, priceSetIds] of priceSetsByQuantity) {
    const calculatedPrices = await pricingModule.calculatePrices(
      { id: [...priceSetIds] },
      { context: { ...pricingContext, quantity } },
    );
    for (const cp of calculatedPrices) {
      priceSetToResult.set(`${cp.id}:${quantity}`, cp);
    }
  }

  const updates: Array<{ id: string; unit_price?: number; compare_at_unit_price?: number | null }> = [];

  for (const item of refreshedCart.items) {
    // 커스텀 단가(함께 구매 등)는 이 함수가 아니라 그 단가를 만든 쪽이 다시 판정한다.
    if (item.is_custom_price) continue;
    const priceSetId = variantToPriceSetId.get(item.variant_id);
    if (!priceSetId) continue;

    const pricing = priceSetToResult.get(`${priceSetId}:${Number(item.quantity)}`);
    if (!pricing) continue;

    const isSalePrice = pricing.calculated_price?.price_list_type === 'sale';
    const originalAmount = pricing.original_amount != null ? Number(pricing.original_amount) : null;
    const calculatedAmount = pricing.calculated_amount != null ? Number(pricing.calculated_amount) : null;

    if (calculatedAmount == null) continue;

    const update: { id: string; unit_price?: number; compare_at_unit_price?: number | null } = { id: item.id };

    const currentUnitPrice = item.unit_price != null ? Number(item.unit_price) : null;
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

    if ('unit_price' in update || 'compare_at_unit_price' in update) {
      updates.push(update);
    }
  }

  if (updates.length > 0) {
    await cartModule.updateLineItems(updates);
  }
}
