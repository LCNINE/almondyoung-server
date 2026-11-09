import type { IInventoryService, MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import {
  planReservationBatch,
  resolveManaged,
  stockedKey,
  type LineItemContext,
  type LineItemReservationRequest,
  type ReservationBatchPlan,
} from './plan';

type LineRow = {
  line_item_id: string;
  variant_id: string | null;
  manage_inventory: boolean | null;
  inventory_items: Array<{ inventory_item_id: string; required_quantity: number }> | null;
  location_ids: string[] | null;
};

/**
 * 줄 → variant → 인벤토리 항목(링크) / 줄 → 주문 → 판매채널 → 재고 위치(링크).
 *
 * 모듈 경계를 셋(order·product·stock location) 넘는 읽기라 링크 테이블을 직접 읽는다(선례:
 * `time-sale/steps.ts` 의 `product_variant_price_set`). 읽기만 한다 — 쓰기는 전부 예약 워크플로가 한다.
 * 주문에 붙지 않은 줄(주문 편집 중 떨어진 줄 등)은 결과에 없어 `not_found` 가 된다.
 * order_item 은 주문 버전마다 행이 있어 줄 하나에 여럿일 수 있으므로 주문 하나만 집는다.
 */
const LINE_CONTEXT_SQL = (placeholders: string) => `
  select li.id as line_item_id,
         li.variant_id,
         pv.manage_inventory,
         (select json_agg(json_build_object('inventory_item_id', pvii.inventory_item_id,
                                            'required_quantity', pvii.required_quantity)
                          order by pvii.inventory_item_id)
            from product_variant_inventory_item pvii
           where pvii.variant_id = pv.id and pvii.deleted_at is null) as inventory_items,
         (select json_agg(scsl.stock_location_id order by scsl.stock_location_id)
            from sales_channel_stock_location scsl
            join stock_location sl on sl.id = scsl.stock_location_id and sl.deleted_at is null
           where scsl.sales_channel_id = o.sales_channel_id and scsl.deleted_at is null) as location_ids
    from order_line_item li
    join lateral (
      select oi.order_id from order_item oi
       where oi.item_id = li.id and oi.deleted_at is null
       order by oi.version desc
       limit 1
    ) oi on true
    join "order" o on o.id = oi.order_id and o.deleted_at is null
    left join product_variant pv on pv.id = li.variant_id and pv.deleted_at is null
   where li.id in (${placeholders}) and li.deleted_at is null
`;

export async function loadLineItemContexts(
  container: MedusaContainer,
  lineItemIds: string[],
): Promise<Map<string, LineItemContext>> {
  const contexts = new Map<string, LineItemContext>();
  if (lineItemIds.length === 0) return contexts;

  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const inventory: IInventoryService = container.resolve(Modules.INVENTORY);

  const placeholders = lineItemIds.map(() => '?').join(',');
  const [{ rows }, reservations] = await Promise.all([
    knex.raw(LINE_CONTEXT_SQL(placeholders), lineItemIds),
    inventory.listReservationItems(
      { line_item_id: lineItemIds },
      { select: ['id', 'line_item_id', 'quantity', 'created_at'], order: { created_at: 'ASC', id: 'ASC' } },
    ),
  ]);

  const existingByLine = new Map<string, Array<{ id: string; quantity: number }>>();
  for (const reservation of reservations) {
    if (!reservation.line_item_id) continue;
    const bucket = existingByLine.get(reservation.line_item_id) ?? [];
    bucket.push({ id: reservation.id, quantity: Number(reservation.quantity) });
    existingByLine.set(reservation.line_item_id, bucket);
  }

  for (const row of rows as LineRow[]) {
    contexts.set(row.line_item_id, {
      lineItemId: row.line_item_id,
      variantId: row.variant_id,
      manageInventory: row.manage_inventory === true,
      inventoryItems: (row.inventory_items ?? []).map((item) => ({
        inventoryItemId: item.inventory_item_id,
        requiredQuantity: Number(item.required_quantity),
      })),
      locationIds: row.location_ids ?? [],
      existing: existingByLine.get(row.line_item_id) ?? [],
    });
  }
  return contexts;
}

/** 관리되는 줄의 (항목, 위치) 중 인벤토리 레벨이 있는 것. 만들기 전에 거르려고 쓴다. */
export async function loadStockedPairs(
  container: MedusaContainer,
  contexts: Map<string, LineItemContext>,
): Promise<Set<string>> {
  const inventoryItemIds = new Set<string>();
  const locationIds = new Set<string>();
  for (const context of contexts.values()) {
    const resolved = resolveManaged(context);
    if (resolved.kind !== 'managed') continue;
    inventoryItemIds.add(resolved.managed.inventoryItemId);
    locationIds.add(resolved.managed.locationId);
  }
  if (inventoryItemIds.size === 0) return new Set();

  const inventory: IInventoryService = container.resolve(Modules.INVENTORY);
  const levels = await inventory.listInventoryLevels(
    { inventory_item_id: [...inventoryItemIds], location_id: [...locationIds] },
    { select: ['id', 'inventory_item_id', 'location_id'] },
  );
  return new Set(levels.map((level) => stockedKey(level.inventory_item_id, level.location_id)));
}

/**
 * 줄마다 Medusa 의 지금 예약을 읽고 계획한다. 읽기만 하므로 보상이 없다.
 * 감소 금지 판정이 «지금» 값으로 되도록 이 스텝은 쓰기 바로 앞, 줄 잠금을 잡은 뒤에 돈다.
 */
export const planLineItemReservationsStep = createStep(
  'plan-line-item-reservations',
  async (input: { items: LineItemReservationRequest[] }, { container }) => {
    const lineItemIds = input.items.map((item) => item.line_item_id);
    const contexts = await loadLineItemContexts(container, lineItemIds);
    const stocked = await loadStockedPairs(container, contexts);
    return new StepResponse<ReservationBatchPlan>(planReservationBatch(input.items, contexts, stocked));
  },
);
