import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';

const MEMBERSHIP_SERVICE_URL = process.env.MEMBERSHIP_SERVICE_URL || 'http://localhost:3040';

export type OrderItem = {
  id: string;
  variant_id?: string | null;
  unit_price: number;
  compare_at_unit_price: number | null;
  quantity: number;
};

type OrderData = {
  id: string;
  customer_id?: string | null;
  created_at: string;
  /** 비회원가를 같은 조건으로 다시 계산하기 위한 가격 컨텍스트 */
  currency_code?: string | null;
  region_id?: string | null;
  items?: OrderItem[];
};

async function getAlmondUserId(customerId: string, container: any): Promise<string | null> {
  const customerModule = container.resolve(Modules.CUSTOMER);
  const customer = await customerModule.retrieveCustomer(customerId, {
    select: ['metadata'],
  });
  return ((customer?.metadata as Record<string, unknown> | null)?.almond_user_id as string | undefined) ?? null;
}

async function getOrderWithPricing(orderId: string, container: any): Promise<OrderData | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: [
      'id',
      'customer_id',
      'created_at',
      'currency_code',
      'region_id',
      'items.id',
      'items.variant_id',
      'items.unit_price',
      'items.compare_at_unit_price',
      'items.quantity',
    ],
    filters: { id: orderId },
  });
  return (data?.[0] as OrderData) ?? null;
}

/**
 * compare_at 기준 할인액. **멤버십 할인만이 아니라 모든 세일 price list 의 할인이 섞인다.**
 *
 * `fixCompareAtPrices` 가 price_list_type === 'sale' 이면 종류를 가리지 않고 compare_at 를 채우는데,
 * 수량 할인(Tiered Prices)에는 고객그룹 규칙이 없어 비회원도 똑같이 받는다. 그래서 이 값은
 * 멤버십 귀속분의 **상한**으로만 쓰고, 실제 귀속은 `resolveMembershipDiscount` 가 가른다.
 */
export function calculateMembershipDiscount(items: OrderItem[]): number {
  return items.reduce((acc, item) => {
    const compareAt = item.compare_at_unit_price;
    if (compareAt != null && compareAt > item.unit_price) {
      return acc + (compareAt - item.unit_price) * item.quantity;
    }
    return acc;
  }, 0);
}

/**
 * 멤버십 고객그룹이 **실제로 깎아준** 금액.
 *
 * 같은 variant 를 멤버십 그룹 없이 다시 계산해 그 가격과 실결제가의 차이를 취한다. 수량 할인처럼
 * 비회원도 받는 세일은 두 계산에 똑같이 반영되므로 차감되어 사라지고, 멤버십 전용 price list 의
 * 기여분만 남는다.
 *
 * compare_at 기준 할인액을 상한으로 둔다 — 주문 시점 이후 정가가 바뀌었더라도 고객이 실제로 덜 낸
 * 금액보다 크게 잡히지 않게 한다. 가격 조회가 실패하면 상한(=옛 동작)으로 떨어진다: 혜택을 놓쳐
 * 무료 이용을 허용하는 것보다, 과다 계상돼 환불이 막히는 쪽이 되돌릴 수 있다(관리자 예외 환불).
 */
export async function resolveMembershipDiscount(
  items: OrderItem[],
  membershipGroupId: string | null,
  container: any,
  logger: { warn: (msg: string) => void },
  /** 주문의 가격 컨텍스트. 실결제가와 같은 조건으로 비교해야 차액이 멤버십 기여분이 된다. */
  pricingContext: { currency_code?: string | null; region_id?: string | null } = {},
): Promise<number> {
  const compareAtDiscount = calculateMembershipDiscount(items);
  if (compareAtDiscount <= 0) return 0;
  if (!membershipGroupId) return compareAtDiscount;

  const variantIds = items.map((i) => i.variant_id).filter((id): id is string => !!id);
  if (variantIds.length === 0) return compareAtDiscount;

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const pricingModule = container.resolve(Modules.PRICING);

    const { data: variants } = await query.graph({
      entity: 'variant',
      fields: ['id', 'price_set.id'],
      filters: { id: variantIds },
    });

    const variantToPriceSet = new Map<string, string>();
    for (const v of variants ?? []) {
      if (v.price_set?.id) variantToPriceSet.set(v.id, v.price_set.id);
    }
    const priceSetIds = [...new Set(variantToPriceSet.values())];
    if (priceSetIds.length === 0) return compareAtDiscount;

    // 멤버십 그룹을 뺀 컨텍스트 = "이 고객이 회원이 아니었다면 냈을 가격".
    const nonMemberPrices = await pricingModule.calculatePrices(
      { id: priceSetIds },
      {
        context: {
          currency_code: pricingContext.currency_code ?? 'krw',
          region_id: pricingContext.region_id ?? undefined,
          customer: { groups: [] },
        },
      },
    );
    const priceSetToAmount = new Map<string, number>();
    for (const cp of nonMemberPrices ?? []) {
      if (cp.calculated_amount != null) priceSetToAmount.set(cp.id, Number(cp.calculated_amount));
    }

    let membershipDiscount = 0;
    // 할인이 걸린 품목 중 비회원가를 못 구한 게 하나라도 있으면 결과를 신뢰할 수 없다.
    // 그대로 두면 "멤버십 귀속 0원" 이 되어 혜택을 쓴 고객이 전액 환불된다 — 돌이킬 수 없는 방향이다.
    let unresolvedDiscountedItems = 0;
    for (const item of items) {
      const hasDiscount =
        item.compare_at_unit_price != null && item.compare_at_unit_price > item.unit_price;
      const priceSetId = item.variant_id ? variantToPriceSet.get(item.variant_id) : undefined;
      const nonMemberPrice = priceSetId ? priceSetToAmount.get(priceSetId) : undefined;

      if (nonMemberPrice == null) {
        if (hasDiscount) unresolvedDiscountedItems += 1;
        continue;
      }
      const perUnit = nonMemberPrice - item.unit_price;
      if (perUnit > 0) membershipDiscount += perUnit * item.quantity;
    }

    if (unresolvedDiscountedItems > 0) {
      logger.warn(
        `[MembershipBenefit] 비회원가를 구하지 못한 할인 품목 ${unresolvedDiscountedItems}건 — ` +
          'compare_at 기준으로 대체한다(과소 계상 시 혜택을 쓴 고객이 전액 환불된다)',
      );
      return compareAtDiscount;
    }

    return Math.min(membershipDiscount, compareAtDiscount);
  } catch (err) {
    logger.warn(
      `[MembershipBenefit] 멤버십 귀속 할인 계산 실패 — compare_at 기준으로 대체한다: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return compareAtDiscount;
  }
}

export default async function handleMembershipBenefitOrder({ event, container }: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve('logger');
  const orderId = event.data.id;
  const eventName = event.name;

  try {
    if (eventName === 'order.placed') {
      const order = await getOrderWithPricing(orderId, container);
      if (!order) {
        logger.warn(`[MembershipBenefit] Order ${orderId} not found`);
        return;
      }

      const customerId = order.customer_id;
      if (!customerId) return;

      const discountAmount = await resolveMembershipDiscount(
        order.items ?? [],
        process.env.MEDUSA_MEMBERSHIP_GROUP_ID?.trim() || null,
        container,
        logger,
        { currency_code: order.currency_code, region_id: order.region_id },
      );
      if (discountAmount <= 0) return;

      const userId = await getAlmondUserId(customerId, container);
      if (!userId) {
        logger.warn(`[MembershipBenefit] Customer ${customerId} has no almond_user_id, skipping`);
        return;
      }

      const recordRes = await fetch(`${MEMBERSHIP_SERVICE_URL}/membership/benefits/internal/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          userId,
          membershipDiscountAmount: Math.round(discountAmount),
          // created_at 은 PG 포맷("...306+00", 공백/offset)으로 올 수 있어 membership 의
          // z.string().datetime()(T+Z 요구)에서 400 이 난다. ISO 로 정규화한다.
          orderDate: new Date(order.created_at).toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });

      // 응답을 확인하지 않으면 401/500 이 조용히 삼켜져 혜택이 영영 기록되지 않는다.
      if (!recordRes.ok) {
        const body = await recordRes.text().catch(() => '');
        logger.error(
          `[MembershipBenefit] record failed (${recordRes.status}) userId=${userId} orderId=${orderId}: ${body.slice(0, 300)}`,
        );
        return;
      }

      logger.info(
        `[MembershipBenefit] Recorded discount: userId=${userId}, orderId=${orderId}, amount=${discountAmount}`,
      );
    } else if (eventName === 'order.canceled') {
      await fetch(`${MEMBERSHIP_SERVICE_URL}/membership/benefits/internal/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
        signal: AbortSignal.timeout(5000),
      });

      logger.info(`[MembershipBenefit] Cancelled benefit for order ${orderId}`);
    }
  } catch (err) {
    logger.error(`[MembershipBenefit] ${eventName} handler error for order ${orderId}:`, err);
  }
}

export const config: SubscriberConfig = {
  event: ['order.placed', 'order.canceled'],
  context: {
    subscriberId: 'membership-benefit-order-handler',
  },
};
