import type { MedusaContainer, PricingContext } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { productsInAnyTimeSales } from '../../../utils/time-sale';

type CartLine = {
  id: string;
  title?: string | null;
  product_id?: string | null;
  variant_id?: string | null;
  unit_price?: unknown;
  quantity?: unknown;
  is_tax_inclusive?: boolean | null;
  is_custom_price?: boolean | null;
};

type LinePrice = { unitPrice: number; taxInclusive: boolean };

type RegularPrice = { amount: number; taxInclusive: boolean };

// 같은 세금 기준일 때만 비교한다. 기준이 다르면 환산이 불확실하므로 거절하지 않고 경고만 남긴다.
export function isBelowRegularPrice(line: LinePrice, regular: RegularPrice, warn: (message: string) => void) {
  if (line.taxInclusive !== regular.taxInclusive) {
    warn('[time-sale] 카트 라인과 정상가의 세금 기준이 달라 가격 비교를 건너뜁니다.');
    return false;
  }

  return line.unitPrice < regular.amount;
}

type CartRow = {
  completed_at?: unknown;
  currency_code?: string;
  region_id?: string | null;
  customer?: { groups?: { id: string }[] | null } | null;
  items?: CartLine[];
};

export type StaleTimeSaleLine = { id: string; title: string };

// 타임세일 가격표에 걸린 적 있는 상품 라인 중 단가가 이 카트 고객 기준 현재 계산가보다 낮은 라인.
// 공개 제한 전환·서비스 OFF·종료·삭제 뒤에도 카트에 남은 옛 세일가를 같은 기준으로 잡는다.
export async function findStaleTimeSalePriceLines(
  container: MedusaContainer,
  cartId: string,
): Promise<StaleTimeSaleLine[]> {
  // 1) 카트 라인
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: [
      'id',
      'completed_at',
      'currency_code',
      'region_id',
      'customer.groups.id',
      'items.id',
      'items.title',
      'items.product_id',
      'items.variant_id',
      'items.unit_price',
      'items.quantity',
      'items.is_tax_inclusive',
      'items.is_custom_price',
    ],
    filters: { id: cartId },
  });
  const cart: CartRow | undefined = carts?.[0];
  const cartLines = (cart?.items ?? []).filter(
    (line): line is CartLine & { variant_id: string; product_id: string } =>
      !!line?.variant_id && !!line.product_id && !line.is_custom_price,
  );
  if (!cart?.currency_code || cart.completed_at || cartLines.length === 0) return [];

  // 2) 타임세일 소속 확인 — 상태 무관. 걸린 상품이 없으면 가격을 계산하지 않는다
  const onSale = await productsInAnyTimeSales(container, [...new Set(cartLines.map((line) => line.product_id))]);
  const lines = cartLines.filter((line) => onSale.has(line.product_id));
  if (lines.length === 0) return [];

  // 3) 현재 계산가 — 카트 고객 그룹·region·라인 수량으로 Medusa 카트와 같은 규칙을 태운다
  const { data: variants } = await query.graph({
    entity: 'variant',
    fields: ['id', 'price_set.id'],
    filters: { id: lines.map((line) => line.variant_id) },
  });
  const priceSetByVariant = new Map<string, string>(
    (variants ?? []).filter((variant) => variant.price_set?.id).map((variant) => [variant.id, variant.price_set!.id]),
  );

  const pricing = container.resolve(Modules.PRICING);
  const logger = container.resolve('logger');
  const groups = (cart.customer?.groups ?? []).map((group) => ({ id: group.id }));
  const quantities = [...new Set(lines.map((line) => Number(line.quantity) || 1))];
  const current = new Map<string, RegularPrice>();
  for (const quantity of quantities) {
    const priceSetIds = lines
      .filter((line) => (Number(line.quantity) || 1) === quantity)
      .map((line) => priceSetByVariant.get(line.variant_id))
      .filter((id): id is string => !!id);
    const context: Record<string, unknown> = {
      currency_code: cart.currency_code,
      quantity,
      ...(cart.region_id ? { region_id: cart.region_id } : {}),
      ...(groups.length ? { customer: { groups } } : {}),
    };
    // 중첩 객체는 저장소가 평탄화해 규칙과 맞춘다(Medusa 카트도 같다). 선언 타입만 좁다.
    const pricingContext = context as PricingContext['context'];
    const prices = await pricing.calculatePrices({ id: [...new Set(priceSetIds)] }, { context: pricingContext });
    for (const price of prices)
      current.set(`${price.id}:${quantity}`, {
        amount: Number(price.calculated_amount),
        taxInclusive: !!price.is_calculated_price_tax_inclusive,
      });
  }

  return lines
    .filter((line) => {
      const key = `${priceSetByVariant.get(line.variant_id) ?? ''}:${Number(line.quantity) || 1}`;
      const price = current.get(key);
      if (!price) return false;

      const linePrice = { unitPrice: Number(line.unit_price), taxInclusive: !!line.is_tax_inclusive };

      return isBelowRegularPrice(linePrice, price, (message) => logger.warn(message));
    })
    .map((line) => ({ id: line.id, title: line.title ?? line.variant_id }));
}
