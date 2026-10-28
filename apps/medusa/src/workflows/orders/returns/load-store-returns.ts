import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

import { toNumber } from '../partial-cancel/amount';
import type { StoreReturnSource } from './describe-store-returns';

type GraphReturn = {
  id: string;
  status: string;
  requested_at?: string | Date | null;
  created_at: string | Date;
  metadata?: Record<string, unknown> | null;
  items?: Array<{ item_id: string; quantity?: unknown } | null> | null;
};

const iso = (v: string | Date) => (v instanceof Date ? v : new Date(v)).toISOString();

/**
 * 고객 반품 목록에 필요한 모양 — 주문의 소유 고객과 반품들(상태·요청 시각·metadata·품목 수량).
 * 반품 품목 수량은 이름으로 고르면 빠진다 — returns.items.* 로 읽는다(return-observation-fields.spec.ts).
 */
export async function loadStoreReturns(
  container: MedusaContainer,
  orderId: string,
): Promise<{ customerId: string | null; returns: StoreReturnSource[] } | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: [
      'id',
      'customer_id',
      'returns.id',
      'returns.status',
      'returns.requested_at',
      'returns.created_at',
      'returns.metadata',
      'returns.items.*',
    ],
    filters: { id: orderId },
  });
  const [order] = data as Array<{ id: string; customer_id?: string | null; returns?: Array<GraphReturn | null> | null }>;
  if (!order) return null;
  return {
    customerId: order.customer_id ?? null,
    returns: (order.returns ?? []).flatMap((r) =>
      r
        ? [
            {
              id: r.id,
              status: r.status,
              requestedAt: r.requested_at ? iso(r.requested_at) : null,
              createdAt: iso(r.created_at),
              metadata: r.metadata ?? null,
              items: (r.items ?? []).flatMap((i) => (i ? [{ itemId: i.item_id, quantity: toNumber(i.quantity ?? 0) }] : [])),
            },
          ]
        : [],
    ),
  };
}
