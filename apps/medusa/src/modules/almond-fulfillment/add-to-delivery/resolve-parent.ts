import type { QueryGraph } from '../service';
import { fetchCoreSelfCancelable } from './core-self-cancelable';

export const ADD_TO_DELIVERY_PARENT_KEY = 'add_to_delivery_parent_order_id';
export const ADD_TO_DELIVERY_CART_KIND = 'add_to_delivery';

const PARENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** 함께 배송을 여는 배송비 그룹(셀메이트·부천 출고). 인쇄·직배송 그룹은 같은 상자로 묶을 수 없다 */
export function addToDeliveryGroupCodes(): Set<string> {
  return new Set(
    (process.env.ADD_TO_DELIVERY_SHIPPING_GROUP_CODES ?? 'default')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
  );
}

// Core 라우트 한 번 상한. 최신 주문부터 묻는다.
const CORE_BATCH_LIMIT = 50;

export type ParentCandidate = {
  orderId: string;
  displayId: number;
  createdAt: string;
  shippingProfileIds: string[];
  shippingAddress: Record<string, unknown>;
};

/** 고객의 출고 전 주문 중 함께 배송 부모가 될 수 있는 것. 최신순. */
export async function listEligibleParents(
  query: QueryGraph,
  input: { customerId: string; shippingProfileId?: string },
): Promise<ParentCandidate[]> {
  const almondUserId = await readAlmondUserId(query, input.customerId);
  if (!almondUserId) return [];

  const since = new Date(Date.now() - PARENT_WINDOW_MS);
  const { data: orders } = await query.graph({
    entity: 'order',
    fields: [
      'id',
      'display_id',
      'customer_id',
      'status',
      'created_at',
      'metadata',
      'shipping_address.*',
      'items.product_id',
      'items.requires_shipping',
    ],
    filters: { customer_id: input.customerId, created_at: { $gte: since.toISOString() } },
  });

  const open = orders.filter((o) => o.customer_id === input.customerId && isOpenParent(o, since));
  const profileByProduct = await loadProfiles(
    query,
    open.flatMap((o) => shippedItems(o).map((i) => i.product_id as string)),
  );

  const candidates = open
    .map((o) => toCandidate(o, profileByProduct))
    .filter((c) => c.shippingProfileIds.length > 0)
    .filter((c) => !input.shippingProfileId || c.shippingProfileIds.includes(input.shippingProfileId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, CORE_BATCH_LIMIT);

  const allowed = new Set(
    await fetchCoreSelfCancelable(
      almondUserId,
      candidates.map((c) => c.orderId),
    ),
  );

  return candidates.filter((c) => allowed.has(c.orderId));
}

export async function resolveParent(
  query: QueryGraph,
  input: { customerId: string; parentOrderId: string; shippingProfileId: string },
): Promise<ParentCandidate | null> {
  const parents = await listEligibleParents(query, input);

  return parents.find((p) => p.orderId === input.parentOrderId) ?? null;
}

async function readAlmondUserId(query: QueryGraph, customerId: string): Promise<string | null> {
  const { data } = await query.graph({ entity: 'customer', fields: ['id', 'metadata'], filters: { id: customerId } });
  const value = data[0]?.metadata?.almond_user_id;

  return typeof value === 'string' && value ? value : null;
}

function isOpenParent(order: Record<string, any>, since: Date): boolean {
  const metadata = order.metadata ?? {};
  if (order.status === 'canceled') return false;
  if (metadata.bank_transfer_status === 'awaiting_deposit') return false;
  if (metadata.refund_status === 'requested') return false;
  if (metadata[ADD_TO_DELIVERY_PARENT_KEY]) return false;
  if (Date.parse(order.created_at) < since.getTime()) return false;

  return shippedItems(order).length > 0;
}

function shippedItems(order: Record<string, any>): Array<Record<string, any>> {
  return (order.items ?? []).filter((i: Record<string, any>) => i?.requires_shipping !== false && i?.product_id);
}

async function loadProfiles(query: QueryGraph, productIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(productIds)];
  const result = new Map<string, string>();
  if (ids.length === 0) return result;

  const allowed = addToDeliveryGroupCodes();
  const { data } = await query.graph({
    entity: 'product',
    fields: ['id', 'shipping_profile.id', 'shipping_profile.metadata'],
    filters: { id: ids },
  });
  for (const product of data) {
    const code = product.shipping_profile?.metadata?.shippingGroupCode;
    if (product.shipping_profile?.id && typeof code === 'string' && allowed.has(code)) {
      result.set(product.id, product.shipping_profile.id);
    }
  }

  return result;
}

function toCandidate(order: Record<string, any>, profileByProduct: Map<string, string>): ParentCandidate {
  const profiles = shippedItems(order)
    .map((i) => profileByProduct.get(i.product_id))
    .filter((p): p is string => Boolean(p));

  return {
    orderId: order.id,
    displayId: order.display_id,
    createdAt: new Date(order.created_at).toISOString(),
    shippingProfileIds: [...new Set(profiles)],
    shippingAddress: order.shipping_address ?? {},
  };
}
