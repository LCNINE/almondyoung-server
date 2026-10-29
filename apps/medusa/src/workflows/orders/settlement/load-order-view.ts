import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';

import { POLICY_SNAPSHOT_KEY, type ShippingPolicySnapshot } from '../../../modules/almond-fulfillment/types';
import { toNumber } from '../partial-cancel/amount';
import type { OrderLine } from '../partial-cancel/plan-partial-cancel';
import { SETTLEMENT_CHARGE_NAMES, type ShippingMethodView } from '../partial-cancel/plan-shipping';

export type OrderView = {
  id: string;
  status: string;
  version: number;
  metadata: Record<string, unknown> | null;
  lines: OrderLine[];
  shippingMethods: ShippingMethodView[];
  postalCode: string | null;
  /** 현재 버전 summary 의 pending_difference. 음수 = 돌려줄 차액 */
  pendingDifference: number;
};

/**
 * 주문을 «현재 버전» 기준으로 읽는다. query.graph 로 order 를 읽으면 주문 수정 뒤 summary·items 가 버전이 섞여 나온다
 * (Task 1 특성 테스트에서 관찰) — 버전을 아는 order 모듈로 읽는다.
 */
export async function loadOrderView(container: MedusaContainer, orderId: string): Promise<OrderView | null> {
  const orderModule = container.resolve(Modules.ORDER);
  const [o] = await orderModule.listOrders(
    { id: orderId },
    {
      select: ['id', 'status', 'version', 'metadata'],
      relations: [
        'items',
        'items.detail',
        'items.adjustments',
        'shipping_methods',
        'shipping_methods.adjustments',
        'summary',
        'shipping_address',
      ],
    },
  );
  if (!o) return null;
  const exchanged = exchangedQuantities(o.items ?? []);
  // order 모듈의 DTO 는 summary 를 단일 객체로 적지만 실제로는 버전별 배열이 올 수 있어 모양을 넓혀 받는다.
  const rawSummary = (o as unknown as { summary?: SummaryRow | SummaryRow[] | null }).summary;
  const summary = Array.isArray(rawSummary) ? (rawSummary.find((s) => s.version === o.version) ?? rawSummary[0]) : rawSummary;
  const pendingDifference = toNumber(summary?.totals?.pending_difference ?? summary?.pending_difference ?? 0);
  if (!Number.isFinite(pendingDifference)) throw new Error(`주문 summary 를 읽지 못했습니다: ${orderId}`);

  return {
    id: o.id,
    status: o.status,
    version: o.version,
    metadata: (o.metadata as Record<string, unknown> | null) ?? null,
    lines: (o.items ?? []).map((i) => ({
      id: i.id,
      title: i.title,
      variantId: i.variant_id ?? null,
      quantity: toNumber(i.quantity),
      unitPrice: toNumber(i.unit_price),
      productId: i.product_id ?? null,
      requiresShipping: i.requires_shipping !== false,
      // items.detail 을 이미 싣는다. 못 읽으면 0 — 하한 검사를 건너뛰고 Medusa 자신의 검증에 맡긴다
      fulfilledQuantity: readFulfilledQuantity(i.detail),
      returnedQuantity: readReturnedQuantity(i.detail),
      exchangeReplacement: isExchangeReplacementMetadata(i.metadata),
      exchangedQuantity: exchanged.get(i.id) ?? 0,
      adjustments: (i.adjustments ?? []).map((a) => ({
        amount: toNumber(a.amount),
        code: a.code ?? null,
        promotion_id: a.promotion_id ?? null,
        description: a.description ?? null,
        // 모델에는 있는데 OrderLineItemAdjustmentDTO 타입에 빠진 필드라 모양만 넓혀 읽는다.
        is_tax_inclusive: !!(a as { is_tax_inclusive?: boolean | null }).is_tax_inclusive,
      })),
    })),
    shippingMethods: (o.shipping_methods ?? []).map((m) => toShippingMethodView(m)),
    postalCode: o.shipping_address?.postal_code ?? null,
    pendingDifference,
  };
}

/** 상품 → 지금 배송 프로필. 그룹 소속은 «지금» 상품의 배송 프로필로 정한다(부분취소·반품 정산). */
export async function productShippingProfiles(container: MedusaContainer, productIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (productIds.length === 0) return map;
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({ entity: 'product', fields: ['id', 'shipping_profile.id'], filters: { id: [...new Set(productIds)] } });
  // 링크 필드(shipping_profile)는 graph 결과 타입에 없다 — 경계에서 좁힌다.
  for (const p of data as Array<{ id: string; shipping_profile?: { id?: string } | null }>) {
    if (p.shipping_profile?.id) map.set(p.id, p.shipping_profile.id);
  }
  return map;
}

/** 배송 방법 → 계획 입력. amount 는 할인 «전» 금액이라, 할인이 붙었는지를 따로 넘긴다(planShipping 이 조정을 멈춘다). */
export function toShippingMethodView(m: {
  id: string;
  shipping_option_id?: string | null;
  amount: unknown;
  name?: string | null;
  data?: Record<string, unknown> | null;
  /** order 모듈이 order_shipping 행을 이 이름으로 싣는다 — 어느 반품·교환·클레임에 속하는지가 여기 있다. */
  detail?: { return_id?: string | null; exchange_id?: string | null; claim_id?: string | null } | null;
  adjustments?: Array<{ amount: unknown } | null> | null;
}): ShippingMethodView {
  return {
    id: m.id,
    shippingOptionId: m.shipping_option_id ?? null,
    amount: toNumber(m.amount),
    snapshot: readSnapshot(m.data),
    isSettlementCharge: !!m.name && SETTLEMENT_CHARGE_NAMES.includes(m.name),
    isReturnExchangeOrClaimShipping: !!(m.detail?.return_id || m.detail?.exchange_id || m.detail?.claim_id),
    hasAdjustments: (m.adjustments ?? []).some((a) => !!a && toNumber(a.amount) !== 0),
  };
}

/** 교환 정산이 넣은 대체 품목 줄의 표지(K8 PR11 N4) — metadata.almondExchange 가 객체면 대체 줄이다. */
export const EXCHANGE_LINE_METADATA_KEY = 'almondExchange';

export function isExchangeReplacementMetadata(metadata: Record<string, unknown> | null | undefined): boolean {
  const v = metadata?.[EXCHANGE_LINE_METADATA_KEY];
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 원래 품목 id → 그 품목을 대신하는 교환 대체 품목 줄의 수량 합. 수량을 못 읽는 줄은 0 — 판정이 «돌아온» 쪽으로 기운다 */
function exchangedQuantities(items: Array<{ quantity: unknown; metadata?: Record<string, unknown> | null }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const i of items) {
    const mark: unknown = i.metadata?.[EXCHANGE_LINE_METADATA_KEY];
    if (!mark || typeof mark !== 'object' || Array.isArray(mark)) continue;
    const source = 'sourceItemId' in mark ? mark.sourceItemId : undefined;
    const q = toNumber(i.quantity);
    if (typeof source !== 'string' || !Number.isFinite(q) || q <= 0) continue;
    out.set(source, (out.get(source) ?? 0) + q);
  }
  return out;
}

function readFulfilledQuantity(detail: { fulfilled_quantity?: unknown } | null | undefined): number {
  const n = toNumber(detail?.fulfilled_quantity ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function readReturnedQuantity(
  detail: { return_received_quantity?: unknown; return_dismissed_quantity?: unknown } | null | undefined,
): number {
  const n = toNumber(detail?.return_received_quantity ?? 0) + toNumber(detail?.return_dismissed_quantity ?? 0);
  return Number.isFinite(n) ? n : 0;
}

type SummaryRow = { version?: number; pending_difference?: unknown; totals?: { pending_difference?: unknown } };

function readSnapshot(data: Record<string, unknown> | null | undefined): ShippingPolicySnapshot | null {
  // Medusa 는 JSON 을 병합 갱신하므로 «지운» 스냅샷은 null 로 남는다. 모양이 맞지 않으면 없는 것으로 본다.
  const v = data?.[POLICY_SNAPSHOT_KEY] as Partial<ShippingPolicySnapshot> | null | undefined;
  if (!v || typeof v !== 'object' || !v.policy || typeof v.shippingProfileId !== 'string') return null;
  return v as ShippingPolicySnapshot;
}

