import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';

const MEMBERSHIP_SERVICE_URL = process.env.MEMBERSHIP_SERVICE_URL || 'http://localhost:3040';

/**
 * membership 의 `internal/*` 라우트는 `Authorization: Bearer ${MEMBERSHIP_INTERNAL_KEY}` 를 요구한다.
 *
 * 키가 없으면 호출을 아예 하지 않고 던진다(바깥 try/catch 가 로그로 받는다). 헤더 없이 보내면 401 이
 * 되는데, 그 실패는 "혜택 미사용" 판정 → 부당 전액 환불로 이어지므로 조용히 흘려보내면 안 된다.
 */
function internalHeaders(): Record<string, string> {
  const key = process.env.MEMBERSHIP_INTERNAL_KEY;
  if (!key) {
    throw new Error('MEMBERSHIP_INTERNAL_KEY is not configured');
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
}

export type OrderItem = {
  id: string;
  variant_id?: string | null;
  unit_price: number;
  compare_at_unit_price: number | null;
  /** order_line_item 에는 없다 — `detail`(order_item) 에서 온다. 아래 `resolveQuantity` 참고. */
  quantity?: number | null;
  /** order_item(버전 조인). 수량의 실제 출처다. */
  detail?: { quantity?: number | null } | null;
};

/**
 * 라인 수량.
 *
 * `order_line_item` 테이블에는 quantity 컬럼이 없다 — `order_item`(버전 조인)에만 있고, graph 에는
 * `items.detail.quantity` 로 노출된다. `items.quantity` 만 요청하면 전 라인이 undefined 로 오고,
 * 금액 계산이 통째로 NaN 이 된다(`JSON.stringify` 가 null 로 직렬화해 기록 API 가 400 을 낸다).
 */
export function resolveQuantity(item: OrderItem): number {
  const raw = item.detail?.quantity ?? item.quantity;
  const quantity = Number(raw);
  return Number.isFinite(quantity) ? quantity : NaN;
}

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
      // 수량은 order_item(=detail)에만 있다. `items.quantity` 는 항상 undefined 로 온다.
      'items.detail.quantity',
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
      return acc + (compareAt - item.unit_price) * resolveQuantity(item);
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
    if (variantToPriceSet.size === 0) return compareAtDiscount;

    // 수량 할인(Tiered Prices)은 price.min_quantity 로 걸러진다 — 컨텍스트에 quantity 가 없으면
    // pricing 모듈이 `min_quantity <= 1` 만 남겨 수량 할인가를 통째로 빼버린다. 그러면 비회원가가
    // 정가로 나와 수량 할인분까지 멤버십 귀속으로 잡힌다(= 고치려던 그 버그).
    // quantity 는 라인마다 다르므로 수량별로 묶어 각각 조회한다.
    const priceSetsByQuantity = new Map<number, Set<string>>();
    for (const item of items) {
      const priceSetId = item.variant_id ? variantToPriceSet.get(item.variant_id) : undefined;
      if (!priceSetId) continue;
      const quantity = resolveQuantity(item);
      if (!Number.isFinite(quantity)) continue;
      const bucket = priceSetsByQuantity.get(quantity) ?? new Set<string>();
      bucket.add(priceSetId);
      priceSetsByQuantity.set(quantity, bucket);
    }
    if (priceSetsByQuantity.size === 0) return compareAtDiscount;

    // 멤버십 그룹을 뺀 컨텍스트 = "이 고객이 회원이 아니었다면 냈을 가격".
    // 빈 groups 배열은 pricing 모듈이 컨텍스트에서 걸러내므로 멤버십 price list 규칙이 매칭되지 않는다.
    const amountByQuantityAndPriceSet = new Map<string, number>();
    for (const [quantity, priceSetIdSet] of priceSetsByQuantity) {
      const nonMemberPrices = await pricingModule.calculatePrices(
        { id: [...priceSetIdSet] },
        {
          context: {
            currency_code: pricingContext.currency_code ?? 'krw',
            region_id: pricingContext.region_id ?? undefined,
            quantity,
            customer: { groups: [] },
          },
        },
      );
      for (const cp of nonMemberPrices ?? []) {
        if (cp.calculated_amount != null) {
          amountByQuantityAndPriceSet.set(`${quantity}:${cp.id}`, Number(cp.calculated_amount));
        }
      }
    }

    let membershipDiscount = 0;
    // 할인이 걸린 품목 중 비회원가를 못 구한 게 하나라도 있으면 결과를 신뢰할 수 없다.
    // 그대로 두면 "멤버십 귀속 0원" 이 되어 혜택을 쓴 고객이 전액 환불된다 — 돌이킬 수 없는 방향이다.
    let unresolvedDiscountedItems = 0;
    for (const item of items) {
      const hasDiscount =
        item.compare_at_unit_price != null && item.compare_at_unit_price > item.unit_price;
      const priceSetId = item.variant_id ? variantToPriceSet.get(item.variant_id) : undefined;
      const quantity = resolveQuantity(item);
      const nonMemberPrice =
        priceSetId && Number.isFinite(quantity)
          ? amountByQuantityAndPriceSet.get(`${quantity}:${priceSetId}`)
          : undefined;

      if (nonMemberPrice == null) {
        if (hasDiscount) unresolvedDiscountedItems += 1;
        continue;
      }
      const perUnit = nonMemberPrice - item.unit_price;
      if (perUnit > 0) membershipDiscount += perUnit * quantity;
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
      // NaN 은 `<= 0` 을 통과한다. 그대로 두면 JSON.stringify 가 null 로 직렬화해 기록 API 가 400 을
      // 내고, 그 실패가 조용히 쌓여 "혜택 미사용" 판정 → 부당 전액 환불로 이어진다. 여기서 끊고 크게 운다.
      if (!Number.isFinite(discountAmount)) {
        logger.error(
          `[MembershipBenefit] 할인액 계산이 수치가 아니다(${discountAmount}) — 기록을 건너뛴다. ` +
            `orderId=${orderId} (주문 라인의 수량 조회 실패가 흔한 원인이다)`,
        );
        return;
      }
      if (discountAmount <= 0) return;

      const userId = await getAlmondUserId(customerId, container);
      if (!userId) {
        logger.warn(`[MembershipBenefit] Customer ${customerId} has no almond_user_id, skipping`);
        return;
      }

      const recordRes = await fetch(`${MEMBERSHIP_SERVICE_URL}/membership/benefits/internal/record`, {
        method: 'POST',
        headers: internalHeaders(),
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
      const cancelRes = await fetch(`${MEMBERSHIP_SERVICE_URL}/membership/benefits/internal/cancel`, {
        method: 'POST',
        headers: internalHeaders(),
        body: JSON.stringify({ orderId }),
        signal: AbortSignal.timeout(5000),
      });

      // record 와 같은 이유로 응답을 확인한다. 안 보면 401/500 이 조용히 삼켜져 취소가 영영 반영되지
      // 않고, 그 주문의 혜택이 계속 "사용됨" 으로 남는다.
      if (!cancelRes.ok) {
        const body = await cancelRes.text().catch(() => '');
        logger.error(
          `[MembershipBenefit] cancel failed (${cancelRes.status}) orderId=${orderId}: ${body.slice(0, 300)}`,
        );
        return;
      }

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
