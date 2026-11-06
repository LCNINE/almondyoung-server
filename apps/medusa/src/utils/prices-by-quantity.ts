/**
 * 수량별 가격 조회. 수량 할인 가격은 price.min_quantity 로 걸러지므로 컨텍스트에 수량이 있어야 한다 —
 * 수량은 라인마다 다르니 같은 수량끼리 묶어 수량당 calculatePrices 한 번만 부른다.
 */
import type { IPricingModuleService } from '@medusajs/framework/types';

type PricingModuleLike = Pick<IPricingModuleService, 'calculatePrices'>;

export type QuantityPrice = { calculated: number; original: number; /** 할인(sale) 가격표가 정한 단가 */ sale?: boolean };

export const priceKey = (quantity: number, priceSetId: string) => `${quantity}:${priceSetId}`;

export async function calculatePricesByQuantity(
  pricingModule: PricingModuleLike,
  requests: Array<{ priceSetId: string; quantity: number }>,
  context: Record<string, unknown>,
): Promise<Map<string, QuantityPrice>> {
  const priceSetsByQuantity = new Map<number, Set<string>>();
  for (const { priceSetId, quantity } of requests) {
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const bucket = priceSetsByQuantity.get(quantity) ?? new Set<string>();
    bucket.add(priceSetId);
    priceSetsByQuantity.set(quantity, bucket);
  }

  const prices = new Map<string, QuantityPrice>();
  for (const [quantity, priceSetIds] of priceSetsByQuantity) {
    const calculated = await pricingModule.calculatePrices(
      { id: [...priceSetIds] },
      { context: { ...context, quantity } },
    );
    for (const cp of calculated ?? []) {
      if (cp.calculated_amount == null) continue;
      const amount = Number(cp.calculated_amount);
      if (!Number.isFinite(amount)) continue;
      const original = cp.original_amount == null ? amount : Number(cp.original_amount);
      prices.set(priceKey(quantity, cp.id), {
        calculated: amount,
        original: Number.isFinite(original) ? original : amount,
        ...(cp.calculated_price?.price_list_type === 'sale' ? { sale: true } : {}),
      });
    }
  }
  return prices;
}
