import { sql } from 'drizzle-orm';
import type { DbService } from '@app/db';
import type { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import type { StoreFulfillmentStatus } from '../dto/store-order-actions.dto';
import { type OrderShipmentPhase, orderFulfillmentPhaseSql } from './order-fulfillment-phase.sql';

/** 주문 하나의 진행 단계 — 칸의 뜻은 `orderFulfillmentPhaseSql` 이 정한다. */
export type OrderFulfillmentPhase = {
  adminPhase: OrderShipmentPhase;
  storePhase: StoreFulfillmentStatus;
  /** 나간 것이 하나라도 있는가 — SO 셀메이트 출고, 창고 출고·직배 넘김, 인쇄 출고. 셀프취소 차단이 읽는다. */
  anyShipped: boolean;
};

type PhaseRow = {
  sales_order_id: string;
  admin_phase: OrderShipmentPhase;
  store_phase: StoreFulfillmentStatus;
  any_shipped: boolean;
};

/**
 * 주문 id 들의 진행 단계를 한 번에 읽는다(목록 페이지가 주문마다 부르면 N+1 이다). 호출자 트랜잭션에서 읽는다(ADR-0025).
 * 반환 맵에 없는 id 는 주문이 없다는 뜻이다 — SQL 은 존재하는 주문마다 정확히 한 행을 낸다.
 * 칸은 SQL 이 낸 그대로 옮긴다 — 여기서 단계를 다시 고르지 않는다.
 */
export async function readOrderFulfillmentPhases(
  db: DbTx | DbService<typeof wmsSchema>['db'],
  salesOrderIds: string[],
): Promise<Map<string, OrderFulfillmentPhase>> {
  if (salesOrderIds.length === 0) return new Map();
  const ids = sql.join(
    salesOrderIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await db.execute<PhaseRow>(
    orderFulfillmentPhaseSql(sql`select x.id from unnest(ARRAY[${ids}]::uuid[]) as x(id)`),
  );
  return new Map(
    rows.map((row) => [
      row.sales_order_id,
      { adminPhase: row.admin_phase, storePhase: row.store_phase, anyShipped: row.any_shipped },
    ]),
  );
}
