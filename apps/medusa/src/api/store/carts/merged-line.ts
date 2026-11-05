import { ContainerRegistrationKeys, Modules, deepEqualObj, isPresent } from '@medusajs/framework/utils';
import type { MedusaContainer } from '@medusajs/framework/types';

type LineLike = {
  id: string;
  variant_id?: string | null;
  quantity: number | string;
  unit_price?: number | string | null;
  is_custom_price?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

type AddedItem = {
  variant_id: string;
  quantity: number;
  metadata?: Record<string, unknown> | null;
};

/**
 * 방금 담은 아이템이 합쳐진 기존 라인. 합쳐질 라인의 판정은 Medusa 가 담기 때 쓰는 조건
 * (같은 variant + 둘 다 metadata 없음 또는 metadata 깊은 동등)과 같다.
 */
export function findMergedLine<T extends LineLike>(items: T[], added: AddedItem): T | null {
  return (
    items.find(
      (item) =>
        item.variant_id === added.variant_id &&
        ((!isPresent(item.metadata) && !isPresent(added.metadata)) || deepEqualObj(item.metadata, added.metadata)) &&
        Number(item.quantity) > added.quantity,
    ) ?? null
  );
}

/**
 * 합쳐진 라인의 단가가 합친 수량 기준 가격과 다른지. Medusa 는 합칠 때 단가를 새로 담은 수량 기준으로
 * 남기므로, 수량 할인 구간을 넘었으면 다르다. 같으면 카트 재계산을 건너뛴다.
 *
 * 가격 조회가 실패하면 재계산하는 쪽으로 간다 — 비용이 들 뿐 틀린 가격이 남지 않는다.
 */
export async function mergedLineNeedsReprice(
  scope: Pick<MedusaContainer, 'resolve'>,
  cartId: string,
  line: LineLike,
): Promise<boolean> {
  if (line.is_custom_price) return false;
  try {
    const query = scope.resolve(ContainerRegistrationKeys.QUERY);
    const [{ data: carts }, { data: variants }] = await Promise.all([
      query.graph({
        entity: 'cart',
        fields: ['id', 'currency_code', 'region_id', 'customer_id', 'customer.groups.id'],
        filters: { id: cartId },
      }),
      query.graph({ entity: 'variant', fields: ['id', 'price_set.id'], filters: { id: line.variant_id } }),
    ]);
    const cart = carts?.[0];
    const priceSetId = variants?.[0]?.price_set?.id;
    if (!cart || !priceSetId) return true;

    const [calculated] = await scope.resolve(Modules.PRICING).calculatePrices(
      { id: [priceSetId] },
      {
        context: {
          currency_code: cart.currency_code,
          region_id: cart.region_id,
          customer_id: cart.customer_id,
          customer: cart.customer,
          quantity: Number(line.quantity),
        },
      },
    );
    if (calculated?.calculated_amount == null) return true;
    return Number(calculated.calculated_amount) !== Number(line.unit_price);
  } catch {
    return true;
  }
}
