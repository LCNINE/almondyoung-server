import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { outstandingLineWhere } from '../../inventory/procurement/services/purchase-order-outstanding.sql';
import { lineReservedQtySql, shipmentReservationTotalsSql } from './shipment-reservation-totals.sql';

export type ReserveShortageItem = {
  skuId: string;
  skuName: string;
  shortQty: number;
  /** 열린 발주 라인 중 가장 이른 도착예정일(YYYY-MM-DD). 없으면 null */
  expectedArrival: string | null;
};

export type ReserveShortage = {
  shipmentId: string;
  /** split-unreserved 의 expectedManifestVersion 으로 그대로 보낸다 */
  manifestVersion: number;
  /** 다른 판매주문 라인을 가진 상자 — 화면이 나눠 보내기 버튼을 막는다(D13) */
  consolidated: boolean;
  /**
   * 대표 상자에 확정 예약이 하나라도 있다 — 나눠도 원 상자에 남는 몫이 있다.
   * 없으면(전부 미예약) split-unreserved 는 SHIPMENT_NOTHING_RESERVED 409 라 화면이 버튼을 내지 않는다.
   */
  splittable: boolean;
  /** 대표 상자의 SKU 종 수와 그중 덜 예약된 종 수 («10종 중 1종») */
  skuKinds: number;
  shortSkuKinds: number;
  /** SKU 별 합, shortQty 큰 순 */
  items: ReserveShortageItem[];
};

type RawRow = {
  sales_order_id: string;
  shipment_id: string;
  manifest_version: number;
  box_reserved_qty: number;
  line_order_id: string;
  sku_id: string;
  sku_name: string;
  qty: number;
  reserved_qty: number;
  expected_arrival: string | null;
};

/**
 * 정체 보드 «예약» 줄의 부족 품목(#1016 15번 · D13). 주문 묶음 하나를 SQL 한 번으로 읽는다.
 * 대표 상자 = 그 주문 라인이 있는 draft · recovery_code NULL 상자 중 «덜 예약된» 것, opened_at 오래된 하나.
 * «덜 예약된»(unreserved_qty > 0)의 정의는 상자 합 한 벌(shipmentReservationTotalsSql)이고 판정 SQL 과 같다.
 * 품목별 부족은 라인별 확정 예약(같은 필터, lineReservedQtySql)을 SKU 로 합친 값이다.
 */
@Injectable()
export class ReserveShortageReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** 덜 예약된 상자가 없는 주문은 맵에 없다 */
  async forOrders(salesOrderIds: string[], tx?: DbTx): Promise<Map<string, ReserveShortage>> {
    if (salesOrderIds.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const ids = sql.join(
        salesOrderIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      const result = await trx.execute(sql`
        WITH cand AS (
          -- 후보 상자(주문 × 상자). 합포장 상자는 라인이 있는 주문마다 한 행씩.
          SELECT DISTINCT fo.sales_order_id, sl.shipment_id
            FROM fulfillment_orders fo
            JOIN fulfillment_order_items foi ON foi.fulfillment_order_id = fo.id
            JOIN shipment_lines sl ON sl.fulfillment_order_item_id = foi.id
            JOIN shipments s ON s.id = sl.shipment_id
           WHERE fo.sales_order_id IN (${ids}) AND s.status = 'draft' AND s.recovery_code IS NULL
        ),
        box_res AS (
          ${shipmentReservationTotalsSql(sql`SELECT c.shipment_id FROM cand c`)}
        ),
        rep AS (
          SELECT DISTINCT ON (c.sales_order_id) c.sales_order_id, s.id AS shipment_id, s.manifest_version, br.reserved_qty AS box_reserved_qty
            FROM cand c
            JOIN box_res br ON br.shipment_id = c.shipment_id
            JOIN shipments s ON s.id = c.shipment_id
           WHERE br.unreserved_qty > 0
           ORDER BY c.sales_order_id, s.opened_at, s.id
        )
        SELECT rep.sales_order_id, rep.shipment_id, rep.manifest_version, rep.box_reserved_qty,
               bfo.sales_order_id AS line_order_id,
               sl.sku_id, k.name AS sku_name, sl.qty,
               ${lineReservedQtySql(sql`sl.id`)} AS reserved_qty,
               arrival.expected_arrival
          FROM rep
          JOIN shipment_lines sl ON sl.shipment_id = rep.shipment_id
          JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
          JOIN fulfillment_orders bfo ON bfo.id = foi.fulfillment_order_id
          JOIN skus k ON k.id = sl.sku_id
          LEFT JOIN LATERAL (
            -- 입고 예정 = 남은 수량이 있는 실발주 라인(창고는 따지지 않는다). 술어는 procurement 한 곳의 것이다
            SELECT to_char(min(${wmsTables.purchaseOrderLines.expectedArrival}), 'YYYY-MM-DD') AS expected_arrival
              FROM ${wmsTables.purchaseOrderLines}
              JOIN ${wmsTables.purchaseOrders} ON ${wmsTables.purchaseOrders.id} = ${wmsTables.purchaseOrderLines.poId}
             WHERE ${wmsTables.purchaseOrderLines.skuId} = sl.sku_id AND ${outstandingLineWhere()}
          ) arrival ON true
      `);
      // execute() 원시 결과 타이핑 — order-progress.reader.ts 와 같은 문서화된 캐스트
      return assemble(result as unknown as RawRow[]);
    }, tx);
  }
}

function assemble(rows: RawRow[]): Map<string, ReserveShortage> {
  const byOrder = new Map<string, RawRow[]>();
  for (const r of rows) {
    const list = byOrder.get(r.sales_order_id);
    if (list) list.push(r);
    else byOrder.set(r.sales_order_id, [r]);
  }
  const out = new Map<string, ReserveShortage>();
  for (const [orderId, lines] of byOrder) {
    const bySku = new Map<string, ReserveShortageItem>();
    for (const l of lines) {
      const cur = bySku.get(l.sku_id) ?? {
        skuId: l.sku_id,
        skuName: l.sku_name,
        shortQty: 0,
        expectedArrival: l.expected_arrival,
      };
      cur.shortQty += Math.max(0, Number(l.qty) - Number(l.reserved_qty));
      bySku.set(l.sku_id, cur);
    }
    const items = [...bySku.values()]
      .filter((i) => i.shortQty > 0)
      .sort((a, b) => b.shortQty - a.shortQty || a.skuName.localeCompare(b.skuName) || a.skuId.localeCompare(b.skuId));
    const first = lines[0];
    out.set(orderId, {
      shipmentId: first.shipment_id,
      manifestVersion: Number(first.manifest_version),
      consolidated: lines.some((l) => l.line_order_id !== orderId),
      splittable: Number(first.box_reserved_qty) > 0,
      skuKinds: bySku.size,
      shortSkuKinds: items.length,
      items,
    });
  }
  return out;
}
