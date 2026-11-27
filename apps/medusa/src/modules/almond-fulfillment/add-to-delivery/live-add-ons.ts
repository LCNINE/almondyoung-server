import type { QueryGraph } from '../service';
import { ADD_TO_DELIVERY_PARENT_KEY } from './resolve-parent';

/** 함께 배송 주문이 전체취소를 시작하면 적는다. 부모 전체취소가 이 주문 몫을 보류하지 않게 한다. */
export const ADD_TO_DELIVERY_CANCELING_KEY = 'add_to_delivery_canceling_at';
import { waivedShippingAmount } from './waived-shipping';

export type RawSql = { raw: (sql: string, bindings: unknown[]) => Promise<{ rows: Array<Record<string, any>> }> };

/** 부모 주문마다 취소되지 않은 함께 배송 주문 id. 부모 metadata 에는 자식을 적지 않으므로 자식 쪽에서 찾는다. */
export async function listLiveAddOns(
  knex: RawSql,
  customerId: string,
  parentOrderIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (parentOrderIds.length === 0) return result;

  const placeholders = parentOrderIds.map(() => '?').join(',');
  const { rows } = await knex.raw(
    `select id, metadata->>'${ADD_TO_DELIVERY_PARENT_KEY}' as parent_id
       from "order"
      where metadata->>'${ADD_TO_DELIVERY_PARENT_KEY}' in (${placeholders})
        and customer_id = ?
        and metadata->>'${ADD_TO_DELIVERY_CANCELING_KEY}' is null
        and status <> 'canceled'
        and deleted_at is null
      order by created_at`,
    [...parentOrderIds, customerId],
  );

  for (const row of rows) {
    const bucket = result.get(row.parent_id) ?? [];
    bucket.push(row.id);
    result.set(row.parent_id, bucket);
  }

  return result;
}

/** 부모만 취소할 때 환불에서 뺄 금액: 살아 있는 함께 배송 주문들의 면제 배송비 합. */
export async function withheldForParent(
  knex: RawSql,
  query: QueryGraph,
  parentOrderId: string,
  excludeChildIds: string[] = [],
): Promise<number> {
  const { data } = await query.graph({
    entity: 'order',
    fields: ['id', 'customer_id'],
    filters: { id: parentOrderId },
  });
  const customerId = data[0]?.customer_id;
  if (!customerId) return 0;

  const excluded = new Set(excludeChildIds);
  const children = ((await listLiveAddOns(knex, customerId, [parentOrderId])).get(parentOrderId) ?? []).filter(
    (id) => !excluded.has(id),
  );
  const amounts = await Promise.all(children.map((id) => waivedShippingAmount(query, id)));

  return amounts.reduce((sum, amount) => sum + amount, 0);
}
