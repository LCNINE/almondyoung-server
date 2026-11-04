import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { buildPricingContext } from '../utils/pricing-context';
import { calculatePricesByQuantity, priceKey, type QuantityPrice } from '../utils/prices-by-quantity';

/**
 * 주문 라인마다 수량 할인 몫을 기록한다(`metadata.price_breakdown`). 주문내역이 «멤버십 할인»과
 * «수량 할인»을 나눠 보이고, 나중에 구간표가 바뀌어도 주문 당시 값이 남게 하기 위해서다.
 * 라인엔 어느 가격표가 적용됐는지 남지 않으므로 같은 고객 조건으로 «주문 수량»과 «1개» 가격을 다시 계산한다.
 * 주문 수량 재계산값이 실제 단가와 다르면(그 사이 가격이 바뀜) 틀린 숫자 대신 기록하지 않는다.
 */

export type PriceBreakdown = {
  base_unit: number;
  before_tier_unit: number;
  tier_discount_unit: number;
};

type BreakdownInput = {
  id: string;
  unitPrice: number;
  metadata: Record<string, unknown> | null | undefined;
  atQuantity?: QuantityPrice;
  atOne?: QuantityPrice;
};

export function buildPriceBreakdowns(
  lines: BreakdownInput[],
): Array<{ id: string; metadata: Record<string, unknown> & { price_breakdown: PriceBreakdown } }> {
  const updates: Array<{ id: string; metadata: Record<string, unknown> & { price_breakdown: PriceBreakdown } }> = [];
  for (const line of lines) {
    // 이미 기록된 분해는 주문 당시 값이다 — 이벤트가 다시 와도 지금 가격으로 덮지 않는다.
    if (line.metadata?.price_breakdown !== undefined) continue;
    if (!line.atQuantity || !line.atOne) continue;
    if (line.atQuantity.calculated !== line.unitPrice) continue;
    const tierDiscount = line.atOne.calculated - line.unitPrice;
    if (tierDiscount <= 0) continue;
    updates.push({
      id: line.id,
      metadata: {
        ...(line.metadata ?? {}),
        price_breakdown: {
          base_unit: line.atOne.original,
          before_tier_unit: line.atOne.calculated,
          tier_discount_unit: tierDiscount,
        },
      },
    });
  }
  return updates;
}

type OrderLine = {
  id: string;
  unit_price: number;
  is_custom_price?: boolean | null;
  metadata?: Record<string, unknown> | null;
  quantity?: number | null;
  detail?: { quantity?: number | null } | null;
  variant?: { metadata?: Record<string, unknown> | null; price_set?: { id?: string | null } | null } | null;
};

const hasTierMetadata = (metadata: Record<string, unknown> | null | undefined) =>
  [metadata?.tieredPrices, metadata?.membershipTieredPrices].some((v) => Array.isArray(v) && v.length > 0);

const lineQuantity = (line: OrderLine) => Number(line.detail?.quantity ?? line.quantity);

export default async function handleOrderPriceBreakdown({ event, container }: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve('logger');
  const orderId = event.data.id;

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data: orders } = await query.graph({
      entity: 'order',
      fields: [
        'id',
        'currency_code',
        'region_id',
        'customer.groups.id',
        'items.id',
        'items.unit_price',
        'items.is_custom_price',
        'items.metadata',
        'items.detail.quantity',
        'items.variant.metadata',
        'items.variant.price_set.id',
      ],
      filters: { id: orderId },
    });
    const order = orders?.[0];
    if (!order) return;

    // 구간가가 있는 상품을 2개 이상 산 라인만 — 대부분의 주문은 여기서 가격 계산 없이 끝난다.
    const candidates = ((order.items ?? []) as OrderLine[]).flatMap((line) => {
      const priceSetId = line.variant?.price_set?.id;
      return !line.is_custom_price &&
        priceSetId &&
        line.metadata?.price_breakdown === undefined &&
        lineQuantity(line) >= 2 &&
        hasTierMetadata(line.variant?.metadata)
        ? [{ line, priceSetId, quantity: lineQuantity(line) }]
        : [];
    });
    if (candidates.length === 0) return;

    const pricingModule = container.resolve(Modules.PRICING);
    const context = buildPricingContext({
      currencyCode: order.currency_code ?? 'krw',
      regionId: order.region_id ?? undefined,
      customerGroupIds: (order.customer?.groups ?? []).map((g: { id: string }) => g.id),
    });
    const prices = await calculatePricesByQuantity(
      pricingModule,
      candidates.flatMap(({ priceSetId, quantity }) => [
        { priceSetId, quantity },
        { priceSetId, quantity: 1 },
      ]),
      context,
    );

    const updates = buildPriceBreakdowns(
      candidates.map(({ line, priceSetId, quantity }) => ({
        id: line.id,
        unitPrice: Number(line.unit_price),
        metadata: line.metadata,
        atQuantity: prices.get(priceKey(quantity, priceSetId)),
        atOne: prices.get(priceKey(1, priceSetId)),
      })),
    );
    if (updates.length === 0) return;

    const orderModule = container.resolve(Modules.ORDER);
    await orderModule.updateOrderLineItems(
      updates.map(({ id, metadata }) => ({ selector: { id }, data: { metadata } })),
    );
  } catch (err) {
    logger.error(`[OrderPriceBreakdown] order ${orderId} 가격 분해 기록 실패:`, err);
  }
}

export const config: SubscriberConfig = {
  event: 'order.placed',
  context: {
    subscriberId: 'order-price-breakdown-handler',
  },
};
