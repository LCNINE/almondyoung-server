import { Injectable } from '@nestjs/common';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx, NewSkuDemandDaily } from '../../schema/inventory.schema';

export interface DemandRebuildResult {
  from: string | null;
  to: string;
  rows: number;
}

/** raw sql 결과의 원시 행 (snake_case 별칭 그대로). 집계는 postgres.js 가 string 으로 줄 수 있어 Number() 로 정규화. */
interface DemandAggRow {
  sku_id: string;
  demand_date: string;
  qty: number | string;
  amount: number | string | null;
}

const INSERT_CHUNK = 1000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * core 판매주문 → sku_demand_daily (스펙 §4.1). 창 단위로 source='core' 행을 지우고 다시 만든다 —
 * 늦은 취소(어제 있던 수요가 오늘 0)가 upsert 만으로는 안 걷히기 때문이다. 한 트랜잭션 안이라 원자적.
 *
 * - 달력일은 SQL 에서 (order_date AT TIME ZONE 'Asia/Seoul')::date 로 고정 — 런타임 TZ 무관.
 * - 날짜 바인딩은 'YYYY-MM-DD' 문자열 + ::date 캐스트. Date 객체를 raw sql 에 넣지 않는다(드라이버 TypeError).
 * - variant → SKU 는 현재의 product_matchings + product_variant_sku_links 로 소급한다(스펙 §4.1).
 */
@Injectable()
export class DemandSeriesWriter {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async rebuildCoreWindow(
    input: { from: string; to: string; coreSince: string | null },
    tx?: DbTx,
  ): Promise<DemandRebuildResult> {
    const from = input.coreSince !== null && input.coreSince > input.from ? input.coreSince : input.from;
    if (from > input.to) return { from, to: input.to, rows: 0 };
    return this.dbService.run(async (trx) => {
      const rows = await this.aggregate(trx, from, input.to);
      const daily = wmsTables.skuDemandDaily;
      await trx
        .delete(daily)
        .where(and(eq(daily.source, 'core'), gte(daily.demandDate, from), lte(daily.demandDate, input.to)));
      const now = new Date();
      for (const part of chunk(rows, INSERT_CHUNK)) {
        await trx
          .insert(daily)
          .values(part)
          .onConflictDoUpdate({
            target: [daily.skuId, daily.demandDate],
            set: { qty: sql`excluded.qty`, amount: sql`excluded.amount`, source: 'core', updatedAt: now },
          });
      }
      return { from, to: input.to, rows: rows.length };
    }, tx);
  }

  async rebuildCoreFull(input: { to: string; coreSince: string | null }, tx?: DbTx): Promise<DemandRebuildResult> {
    return this.dbService.run(async (trx) => {
      const from = input.coreSince ?? (await this.firstCoreOrderDate(trx));
      if (from === null) return { from: null, to: input.to, rows: 0 };
      return this.rebuildCoreWindow({ from, to: input.to, coreSince: input.coreSince }, trx);
    }, tx);
  }

  private async firstCoreOrderDate(trx: DbTx): Promise<string | null> {
    const [row] = await trx
      .select({
        first: sql<string | null>`MIN((${wmsTables.salesOrders.orderDate} AT TIME ZONE 'Asia/Seoul')::date)::text`,
      })
      .from(wmsTables.salesOrders);
    return row?.first ?? null;
  }

  private async aggregate(trx: DbTx, from: string, to: string): Promise<NewSkuDemandDaily[]> {
    const query = sql`
      WITH lines AS (
        SELECT (o.order_date AT TIME ZONE 'Asia/Seoul')::date AS demand_date,
               sol.quantity AS line_qty,
               sol.total_price AS line_amount,
               pm.id AS matching_id
        FROM sales_order_lines sol
        JOIN sales_orders o ON o.id = sol.sales_order_id
        JOIN product_matchings pm ON pm.variant_id = sol.variant_id
        WHERE o.status NOT IN ('cancelled', 'timeout')
          AND sol.status <> 'cancelled'
          AND COALESCE(sol.fulfillment_kind, 'physical') <> 'digital'
          AND COALESCE(sol.requires_shipping, true)
          AND (o.order_date AT TIME ZONE 'Asia/Seoul')::date BETWEEN ${from}::date AND ${to}::date
      ),
      links AS (
        SELECT product_matching_id, sku_id, quantity,
               SUM(quantity) OVER (PARTITION BY product_matching_id) AS total_qty
        FROM product_variant_sku_links
      ),
      exploded AS (
        SELECT k.sku_id, l.demand_date,
               l.line_qty * k.quantity AS qty,
               CASE WHEN l.line_amount IS NULL THEN NULL
                    ELSE l.line_amount::numeric * k.quantity / k.total_qty END AS amount
        FROM lines l
        JOIN links k ON k.product_matching_id = l.matching_id
      )
      SELECT sku_id,
             demand_date::text AS demand_date,
             SUM(qty)::int AS qty,
             CASE WHEN COUNT(amount) = 0 THEN NULL ELSE ROUND(SUM(amount))::bigint END AS amount
      FROM exploded
      GROUP BY sku_id, demand_date
    `;
    const result = await trx.execute(query);
    // execute() 원시 결과 타이핑 — ledger-reconciliation.service.ts:120 과 같은 문서화된 캐스트.
    const raw = result as unknown as DemandAggRow[];
    return raw.map((r) => ({
      skuId: r.sku_id,
      demandDate: r.demand_date,
      qty: Number(r.qty),
      amount: r.amount === null ? null : Number(r.amount),
      source: 'core' as const,
    }));
  }
}
