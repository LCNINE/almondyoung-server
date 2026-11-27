import { MedusaError } from '@medusajs/framework/utils';

import type { QueryGraph } from '../../../modules/almond-fulfillment/service';
import {
  ADD_TO_DELIVERY_CART_KIND,
  ADD_TO_DELIVERY_PARENT_KEY,
  listEligibleParents,
  resolveParent,
  type ParentCandidate,
} from '../../../modules/almond-fulfillment/add-to-delivery/resolve-parent';
import { listLiveAddOns, type RawSql } from '../../../modules/almond-fulfillment/add-to-delivery/live-add-ons';
import { waivedShippingAmount } from '../../../modules/almond-fulfillment/add-to-delivery/waived-shipping';

export const PARENT_UNAVAILABLE_MESSAGE = '함께 받을 주문이 방금 출고됐어요. 배송비를 포함해 다시 결제해 주세요.';

const ADDRESS_FIELDS = [
  'first_name',
  'last_name',
  'phone',
  'postal_code',
  'address_1',
  'address_2',
  'city',
  'province',
  'country_code',
] as const;

export type ParentView = {
  order_id: string;
  display_id: number;
  created_at: string;
  address: { name: string; phone: string; postal_code: string; address_1: string; address_2: string };
};

export type CreateCartInput = {
  region_id: string;
  sales_channel_id?: string;
  customer_id: string;
  email?: string;
  shipping_address: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

/** 상품 상세 버튼: 이 상품과 같은 배송비 그룹의 부모 후보. 배송지가 같으면 가장 최근 하나만. */
export async function listParentsForProduct(
  query: QueryGraph,
  customerId: string,
  productId: string,
): Promise<ParentView[]> {
  const shippingProfileId = await productProfile(query, productId);
  if (!shippingProfileId) return [];

  const parents = await listEligibleParents(query, { customerId, shippingProfileId });
  const seen = new Set<string>();

  return parents
    .filter((p) => {
      const key = addressKey(p.shippingAddress);
      if (seen.has(key)) return false;

      seen.add(key);

      return true;
    })
    .map(toView);
}

/** 부모 배송지를 그대로 복사한 빈 카트를 만든다. 상품은 일반 담기 경로로 넣는다(담기 제한 미들웨어를 그대로 탄다). */
export async function startAddToDeliveryCart(
  deps: { query: QueryGraph; createCart: (input: CreateCartInput) => Promise<{ id: string }> },
  customerId: string,
  body: { parent_order_id: string; variant_id: string },
): Promise<{ cart_id: string }> {
  const shippingProfileId = await variantProfile(deps.query, body.variant_id);
  const parent = shippingProfileId
    ? await resolveParent(deps.query, { customerId, parentOrderId: body.parent_order_id, shippingProfileId })
    : null;

  if (!parent) throw new MedusaError(MedusaError.Types.CONFLICT, PARENT_UNAVAILABLE_MESSAGE);

  const { data } = await deps.query.graph({
    entity: 'order',
    fields: ['id', 'region_id', 'sales_channel_id', 'email'],
    filters: { id: parent.orderId },
  });
  const order = data[0];

  const cart = await deps.createCart({
    region_id: order.region_id,
    sales_channel_id: order.sales_channel_id ?? undefined,
    customer_id: customerId,
    email: order.email ?? undefined,
    shipping_address: copyAddress(parent.shippingAddress),
    metadata: { cart_kind: ADD_TO_DELIVERY_CART_KIND, [ADD_TO_DELIVERY_PARENT_KEY]: parent.orderId },
  });

  return { cart_id: cart.id };
}

export type LinkView = {
  parent_order_id: string | null;
  children: string[];
  waived_amount: number;
  withheld_amount: number;
};

/** 마이페이지: 주문마다 함께 배송 연결과 면제·차감 금액. 본인 주문만. */
export async function readLinks(
  deps: { query: QueryGraph; knex: RawSql },
  customerId: string,
  orderIds: string[],
): Promise<Record<string, LinkView>> {
  const { data } = await deps.query.graph({
    entity: 'order',
    fields: ['id', 'customer_id', 'metadata'],
    filters: { id: orderIds },
  });
  const own = data.filter((o) => o.customer_id === customerId);
  const childrenByParent = await listLiveAddOns(
    deps.knex,
    customerId,
    own.map((o) => o.id),
  );

  const views = await Promise.all(
    own.map(async (o): Promise<[string, LinkView]> => {
      const parentId =
        typeof o.metadata?.[ADD_TO_DELIVERY_PARENT_KEY] === 'string' ? o.metadata[ADD_TO_DELIVERY_PARENT_KEY] : null;
      const children = childrenByParent.get(o.id) ?? [];
      const waived = parentId ? await waivedShippingAmount(deps.query, o.id) : 0;
      const childAmounts = await Promise.all(children.map((id) => waivedShippingAmount(deps.query, id)));

      return [
        o.id,
        {
          parent_order_id: parentId,
          children,
          waived_amount: waived,
          withheld_amount: childAmounts.reduce((sum, a) => sum + a, 0),
        },
      ];
    }),
  );

  return Object.fromEntries(views);
}

async function productProfile(query: QueryGraph, productId: string): Promise<string | null> {
  const { data } = await query.graph({
    entity: 'product',
    fields: ['id', 'shipping_profile.id'],
    filters: { id: productId },
  });

  return data[0]?.shipping_profile?.id ?? null;
}

async function variantProfile(query: QueryGraph, variantId: string): Promise<string | null> {
  const { data } = await query.graph({
    entity: 'product_variant',
    fields: ['id', 'product.shipping_profile.id'],
    filters: { id: variantId },
  });

  return data[0]?.product?.shipping_profile?.id ?? null;
}

function addressKey(address: Record<string, any>): string {
  return ['first_name', 'last_name', 'phone', 'postal_code', 'address_1', 'address_2']
    .map((f) => String(address?.[f] ?? '').trim())
    .join('|');
}

function copyAddress(address: Record<string, any>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};

  for (const field of ADDRESS_FIELDS) {
    if (address?.[field] != null) copy[field] = address[field];
  }

  return copy;
}

function toView(p: ParentCandidate): ParentView {
  const a = p.shippingAddress as Record<string, any>;

  return {
    order_id: p.orderId,
    display_id: p.displayId,
    created_at: p.createdAt,
    address: {
      name: [a.last_name, a.first_name].filter(Boolean).join('') || '',
      phone: a.phone ?? '',
      postal_code: a.postal_code ?? '',
      address_1: a.address_1 ?? '',
      address_2: a.address_2 ?? '',
    },
  };
}
