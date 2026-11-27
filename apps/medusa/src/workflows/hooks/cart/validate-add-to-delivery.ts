import { MedusaError } from '@medusajs/framework/utils';

import type { QueryGraph } from '../../../modules/almond-fulfillment/service';
import { POLICY_SNAPSHOT_KEY, type ShippingPolicySnapshot } from '../../../modules/almond-fulfillment/types';
import {
  ADD_TO_DELIVERY_PARENT_KEY,
  resolveParent,
} from '../../../modules/almond-fulfillment/add-to-delivery/resolve-parent';

export const ADD_TO_DELIVERY_REJECT_MESSAGE = '함께 받을 주문이 방금 출고됐어요. 배송비를 포함해 다시 결제해 주세요.';
const INSTANT_ONLY_MESSAGE = '함께 배송 주문은 즉시 결제로만 결제할 수 있어요.';

const ADDRESS_FIELDS = ['first_name', 'last_name', 'phone', 'postal_code', 'address_1', 'address_2'] as const;

/** 결제 순간 함께 배송 부모를 다시 판정한다. PG 승인 전이라 막아도 돈이 움직이지 않는다. */
export async function validateAddToDelivery(query: QueryGraph, cart: { id: string }): Promise<void> {
  const { data } = await query.graph({
    entity: 'cart',
    fields: ['id', 'customer_id', 'metadata', 'shipping_address.*', 'shipping_methods.data'],
    filters: { id: cart.id },
  });
  const row = data[0];
  const parentOrderId = row?.metadata?.[ADD_TO_DELIVERY_PARENT_KEY];

  if (typeof parentOrderId !== 'string' || !parentOrderId) return;

  if (row.metadata?.bank_transfer_status === 'awaiting_deposit') {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, INSTANT_ONLY_MESSAGE);
  }

  const snapshot = (row.shipping_methods ?? [])
    .map((m: Record<string, any>) => m?.data?.[POLICY_SNAPSHOT_KEY] as ShippingPolicySnapshot | undefined)
    .find((s: ShippingPolicySnapshot | undefined) => Boolean(s?.shippingProfileId));
  if (!snapshot || !row.customer_id) reject();

  const parent = await resolveParent(query, {
    customerId: row.customer_id,
    parentOrderId,
    shippingProfileId: snapshot.shippingProfileId,
  });
  if (!parent) reject();

  if (!sameAddress(row.shipping_address, parent.shippingAddress)) reject();
}

function reject(): never {
  throw new MedusaError(MedusaError.Types.NOT_ALLOWED, ADD_TO_DELIVERY_REJECT_MESSAGE);
}

function sameAddress(a: Record<string, any> | null | undefined, b: Record<string, any> | null | undefined): boolean {
  if (!a || !b) return false;

  return ADDRESS_FIELDS.every((f) => (a[f] ?? '').trim() === (b[f] ?? '').trim());
}
