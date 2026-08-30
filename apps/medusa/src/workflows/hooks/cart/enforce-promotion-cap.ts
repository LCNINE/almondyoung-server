import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';
import {
  findCapViolations,
  planPromotionCap,
  type CapViolation,
  type CappableAdjustment,
} from './promotion-cap';

/**
 * 캡 계산에 필요한 최소 필드. 카트 전체를 끌어오면 재계산마다 비용이 붙는다.
 */
const CART_CAP_FIELDS = [
  'id',
  'promotions.id',
  'items.id',
  'items.adjustments.id',
  'items.adjustments.amount',
  'items.adjustments.promotion_id',
  'shipping_methods.id',
  'shipping_methods.adjustments.id',
  'shipping_methods.adjustments.amount',
  'shipping_methods.adjustments.promotion_id',
];

type LineAdjustment = CappableAdjustment & { item_id: string };
type ShippingAdjustment = CappableAdjustment & { shipping_method_id: string };

interface CapState {
  lineAdjustments: LineAdjustment[];
  shippingAdjustments: ShippingAdjustment[];
  capByPromotionId: Map<string, number>;
}

/**
 * 카트의 adjustment 와 「캡이 걸린 프로모션」 목록을 읽는다.
 *
 * 캡이 하나도 없으면 `null` — 호출부가 곧바로 빠져나가 재계산 비용을 0 으로 만든다.
 * 쿠폰 없는 카트가 절대다수이므로 이 조기 반환이 이 기능의 실질 비용이다.
 */
async function readCapState(container: any, cartId: string): Promise<CapState | null> {
  if (!cartId) return null;

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: CART_CAP_FIELDS,
    filters: { id: cartId },
  });

  const cart: any = carts?.[0];
  if (!cart) return null;

  const promotionIds: string[] = (cart.promotions ?? [])
    .map((promotion: any) => promotion?.id)
    .filter(Boolean);
  if (!promotionIds.length) return null;

  const metaService: any = container.resolve(PROMOTION_META_MODULE);
  const metas: any[] = await metaService.getByPromotionIds([...new Set(promotionIds)]);

  const capByPromotionId = new Map<string, number>();
  for (const meta of metas ?? []) {
    const cap = Number(meta?.max_discount_amount);
    if (meta?.max_discount_amount != null && Number.isFinite(cap)) {
      capByPromotionId.set(meta.promotion_id, cap);
    }
  }
  if (!capByPromotionId.size) return null;

  const lineAdjustments: LineAdjustment[] = [];
  for (const item of cart.items ?? []) {
    for (const adjustment of item?.adjustments ?? []) {
      lineAdjustments.push({
        id: adjustment.id,
        promotion_id: adjustment.promotion_id,
        amount: Number(adjustment.amount),
        item_id: item.id,
      });
    }
  }

  const shippingAdjustments: ShippingAdjustment[] = [];
  for (const shippingMethod of cart.shipping_methods ?? []) {
    for (const adjustment of shippingMethod?.adjustments ?? []) {
      shippingAdjustments.push({
        id: adjustment.id,
        promotion_id: adjustment.promotion_id,
        amount: Number(adjustment.amount),
        shipping_method_id: shippingMethod.id,
      });
    }
  }

  return { lineAdjustments, shippingAdjustments, capByPromotionId };
}

/**
 * 캡을 넘는 할인을 **깎아서 되쓴다** (#488 A4).
 *
 * 엔진이 adjustment 를 만든 **뒤**에 불려야 한다. 프로모션이 다시 계산될 때마다 adjustment 도
 * 새로 만들어지므로(`updateCartPromotionsWorkflow` 가 REPLACE 다) 이 함수는 매번 **캡 이전
 * 금액**을 보고, 두 번 깎이는 일이 없다.
 *
 * `set*Adjustments` 가 아니라 `upsert*Adjustments` 를 쓰는 것은 의도다 — `set` 은 목록에 없는
 * adjustment 를 **soft delete** 한다(`cart-module.js:363-378` 확인). 캡 대상이 아닌 것까지 사라진다.
 */
export async function enforcePromotionCap(container: any, cartId: string): Promise<void> {
  const state = await readCapState(container, cartId);
  if (!state) return;

  const plan = planPromotionCap(
    [...state.lineAdjustments, ...state.shippingAdjustments],
    state.capByPromotionId,
  );
  if (!plan.length) return;

  const nextAmountById = new Map(plan.map((entry) => [entry.id, entry.amount]));
  const cartModule: any = container.resolve(Modules.CART);

  const lineWrites = state.lineAdjustments
    .filter((adjustment) => nextAmountById.has(adjustment.id))
    .map((adjustment) => ({
      id: adjustment.id,
      item_id: adjustment.item_id,
      amount: nextAmountById.get(adjustment.id) as number,
    }));
  if (lineWrites.length) {
    await cartModule.upsertLineItemAdjustments(lineWrites);
  }

  const shippingWrites = state.shippingAdjustments
    .filter((adjustment) => nextAmountById.has(adjustment.id))
    .map((adjustment) => ({
      id: adjustment.id,
      shipping_method_id: adjustment.shipping_method_id,
      amount: nextAmountById.get(adjustment.id) as number,
    }));
  if (shippingWrites.length) {
    await cartModule.upsertShippingMethodAdjustments(shippingWrites);
  }
}

/**
 * 캡이 지켜지고 있는지만 본다. 고치지 않는다 — 주문 확정 백스톱이 쓴다.
 */
export async function findPromotionCapViolations(
  container: any,
  cartId: string,
): Promise<CapViolation[]> {
  const state = await readCapState(container, cartId);
  if (!state) return [];
  return findCapViolations(
    [...state.lineAdjustments, ...state.shippingAdjustments],
    state.capByPromotionId,
  );
}
