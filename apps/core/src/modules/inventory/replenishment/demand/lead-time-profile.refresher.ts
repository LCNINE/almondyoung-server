import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { ReplenishmentSettingsReader } from './replenishment-settings.reader';
import { addDays } from './calendar';

export interface LeadTimeRefreshResult {
  suppliers: number;
  routes: number;
  windowFrom: string;
  windowTo: string;
}

/** raw sql 결과의 원시 행. 집계는 postgres.js 가 string 으로 줄 수 있어 Number() 로 정규화. */
interface SupplierObsRow {
  supplier_id: string;
  n: number | string;
  mean_days: number | string;
  std_days: number | string | null;
}
interface RouteObsRow {
  from_warehouse_id: string;
  to_warehouse_id: string;
  n: number | string;
  mean_days: number | string;
  std_days: number | string | null;
}

/**
 * 리드타임 프로필 (스펙 §4.4). 관측 창은 최근 lead_time_window_days. 두 표를 통째로 다시 만든다 —
 * 프로필은 파생값이라 delete + insert 가 upsert 와 같고, 관측이 사라진 공급사 행이 남지 않는다.
 * 날짜 바인딩은 'YYYY-MM-DD' 문자열 + ::date (Date 객체 raw 바인딩 금지).
 */
@Injectable()
export class LeadTimeProfileRefresher {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly settingsReader: ReplenishmentSettingsReader,
  ) {}

  async refreshAll(input: { today: string }, tx?: DbTx): Promise<LeadTimeRefreshResult> {
    return this.dbService.run(async (trx) => {
      const settings = await this.settingsReader.read(trx);
      const windowTo = input.today;
      const windowFrom = addDays(input.today, -settings.leadTimeWindowDays);
      const computedAt = new Date();

      const suppliers = await this.observeSuppliers(trx, windowFrom);
      await trx.delete(wmsTables.supplierLeadTimeProfiles);
      if (suppliers.length > 0) {
        await trx
          .insert(wmsTables.supplierLeadTimeProfiles)
          .values(
            suppliers.map((r) => ({
              supplierId: r.supplier_id,
              observations: Number(r.n),
              meanDays: Number(r.mean_days),
              stdDays: r.std_days === null ? null : Number(r.std_days),
              windowFrom,
              windowTo,
              computedAt,
            })),
          )
          // READ COMMITTED 에서 겹쳐 도는 두 런: 뒤 런의 DELETE 가 앞 런이 방금 커밋한 행을 못 잡고,
          // 이어지는 bare INSERT 가 PK 충돌로 죽는다. 두 런 다 같은 이력에서 값을 뽑으므로 병합해도
          // 결과가 한 런과 같다 — 그래서 삭제 못 지운 행 위에 upsert 로 덮어써도 안전하다.
          .onConflictDoUpdate({
            target: wmsTables.supplierLeadTimeProfiles.supplierId,
            set: {
              observations: sql`excluded.observations`,
              meanDays: sql`excluded.mean_days`,
              stdDays: sql`excluded.std_days`,
              windowFrom: sql`excluded.window_from`,
              windowTo: sql`excluded.window_to`,
              computedAt,
              updatedAt: computedAt,
            },
          });
      }

      const routes = await this.observeRoutes(trx, windowFrom);
      await trx.delete(wmsTables.routeLeadTimeProfiles);
      if (routes.length > 0) {
        await trx
          .insert(wmsTables.routeLeadTimeProfiles)
          .values(
            routes.map((r) => ({
              fromWarehouseId: r.from_warehouse_id,
              toWarehouseId: r.to_warehouse_id,
              observations: Number(r.n),
              meanDays: Number(r.mean_days),
              stdDays: r.std_days === null ? null : Number(r.std_days),
              windowFrom,
              windowTo,
              computedAt,
            })),
          )
          // 위 supplier insert 와 같은 이유 — 겹쳐 도는 런의 PK 충돌을 병합으로 흡수한다.
          .onConflictDoUpdate({
            target: [wmsTables.routeLeadTimeProfiles.fromWarehouseId, wmsTables.routeLeadTimeProfiles.toWarehouseId],
            set: {
              observations: sql`excluded.observations`,
              meanDays: sql`excluded.mean_days`,
              stdDays: sql`excluded.std_days`,
              windowFrom: sql`excluded.window_from`,
              windowTo: sql`excluded.window_to`,
              computedAt,
              updatedAt: computedAt,
            },
          });
      }

      return { suppliers: suppliers.length, routes: routes.length, windowFrom, windowTo };
    }, tx);
  }

  /** L1: 발주 라인 ordered_at → 같은 PO 계획의 같은 SKU 아이템에 붙은 첫 posted 입고. */
  private async observeSuppliers(trx: DbTx, windowFrom: string): Promise<SupplierObsRow[]> {
    const result = await trx.execute(sql`
      WITH first_receipt AS (
        SELECT ip.linked_purchase_order_id AS po_id, ipi.sku_id, MIN(ir.occurred_at) AS received_at
        FROM inbound_plans ip
        JOIN inbound_plan_items ipi ON ipi.plan_id = ip.id
        JOIN inbound_receipt_lines irl ON irl.plan_item_id = ipi.id
        JOIN inbound_receipts ir ON ir.id = irl.receipt_id AND ir.status = 'posted'
        GROUP BY ip.linked_purchase_order_id, ipi.sku_id
      ),
      obs AS (
        SELECT po.supplier_id,
               EXTRACT(EPOCH FROM (fr.received_at - pol.ordered_at)) / 86400.0 AS days
        FROM purchase_order_lines pol
        JOIN purchase_orders po ON po.id = pol.po_id
        JOIN first_receipt fr ON fr.po_id = pol.po_id AND fr.sku_id = pol.sku_id
        WHERE pol.status = 'ordered'
          AND pol.ordered_at IS NOT NULL
          AND po.supplier_id IS NOT NULL
          AND pol.ordered_at >= ${windowFrom}::date
          AND fr.received_at >= pol.ordered_at
      )
      SELECT supplier_id,
             COUNT(*)::int AS n,
             AVG(days)::float8 AS mean_days,
             STDDEV_SAMP(days)::float8 AS std_days
      FROM obs
      GROUP BY supplier_id
    `);
    // execute() 원시 결과 타이핑 — ledger-reconciliation.service.ts:120 과 같은 문서화된 캐스트.
    return result as unknown as SupplierObsRow[];
  }

  /** L2: 지시서 shipped_at → 첫 수령. */
  private async observeRoutes(trx: DbTx, windowFrom: string): Promise<RouteObsRow[]> {
    const result = await trx.execute(sql`
      WITH first_receipt AS (
        SELECT transfer_order_id, MIN(received_at) AS received_at
        FROM transfer_order_receipts
        GROUP BY transfer_order_id
      ),
      obs AS (
        SELECT t.from_warehouse_id, t.to_warehouse_id,
               EXTRACT(EPOCH FROM (fr.received_at - t.shipped_at)) / 86400.0 AS days
        FROM transfer_orders t
        JOIN first_receipt fr ON fr.transfer_order_id = t.id
        WHERE t.shipped_at IS NOT NULL
          AND t.shipped_at >= ${windowFrom}::date
          AND fr.received_at >= t.shipped_at
      )
      SELECT from_warehouse_id, to_warehouse_id,
             COUNT(*)::int AS n,
             AVG(days)::float8 AS mean_days,
             STDDEV_SAMP(days)::float8 AS std_days
      FROM obs
      GROUP BY from_warehouse_id, to_warehouse_id
    `);
    // execute() 원시 결과 타이핑 — 위와 같은 문서화된 캐스트.
    return result as unknown as RouteObsRow[];
  }
}
