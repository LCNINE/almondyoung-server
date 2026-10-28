import { eq, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  lineCanceledQuantitySql,
  lineDemandSql,
  lineRemainingSql,
  lineReturnHeldSql,
  lineSkuQuantitiesSql,
} from './line-quantities.sql';

/** 라인 × SKU(구성품) 층 — 칸의 뜻은 `lineSkuQuantitiesSql` 이 정한다. */
export type LineSkuQuantities = {
  skuId: string;
  /** 굳은 구성의 1개당 수량. 구성 밖 SKU 의 FOI 면 null. */
  qtyPerUnit: number | null;
  required: number;
  shipped: number;
  /** 직배 파트너에게 넘긴 미출고 — 출고가 아니다. */
  forwarded: number;
  delivered: number;
  /** 직배 파트너가 완료한 수량 — 배송완료가 아니다(표시용). */
  partnerCompleted: number;
  outstanding: number;
  /** 진행 중 반품 예정 수량(SKU 단위). */
  returnActive: number;
  /** 정산 끝난 반품 수량 — 돌아온 물건. */
  returnConsumed: number;
  /** 더 반품할 수 있는 SKU 수량. 음수일 수 있다(회수가 배송완료를 되돌린 경우) — 표시는 소비자가 클램프한다. */
  claimable: number;
};

export type LineQuantities = {
  salesOrderLineId: string;
  ordered: number;
  canceledBeforeShipment: number;
  canceledAfterShipment: number;
  /** 갈래 무관 합 — «남은 수량» 계산용. */
  canceled: number;
  /** ordered − canceledBeforeShipment. */
  demand: number;
  /** ordered − canceled — 취소되지 않고 남은 판매 단위. 반품을 빼지 않는다(채널 줄 수량과 비교되는 값이다). */
  remaining: number;
  /** 반품이 잡은 판매 단위 — 취소 상한에서만 뺀다. `remaining` 은 반품을 모른다(N6). */
  returnHeld: number;
  /**
   * SKU 순. 주문에 FO 가 없으면 [] — 운영자가 FO 전에 구성을 지정했어도 비어 있다(스펙 §6.1 «FO 전에는 SKU 층이 비고»).
   * FOI 가 없는 인쇄 외주·디지털 라인도 [].
   */
  skus: LineSkuQuantities[];
};

type LineSkuRow = {
  sales_order_line_id: string;
  sku_id: string;
  qty_per_unit: number | null;
  required: number;
  shipped: number;
  forwarded: number;
  delivered: number;
  partner_completed: number;
  outstanding: number;
  return_active: number;
  return_consumed: number;
  claimable: number;
};

/**
 * 판매주문의 라인별 수량을 읽는 문 (K6 PR2a, SKU 층은 PR2b, 청구 사실은 PR3a). 호출자 트랜잭션에서 읽는다(ADR-0025).
 * 그 주문의 모든 판매 라인이 키로 있다 — 취소가 없는 라인도 0 으로 나온다(빠지면 소비자의 `?? 0` 이 오류를 숨긴다).
 * 칼럼은 전부 `line-quantities.sql.ts` 의 조각에서 select 한다 — 여기서 산술하지 않는다.
 * SKU 층은 조각을 주문 범위로 한 번 select 해 라인별로 묶는다(묶기는 산술이 아니다).
 */
export async function readLineQuantities(trx: DbTx, salesOrderId: string): Promise<Map<string, LineQuantities>> {
  const sol = wmsTables.salesOrderLines;
  const rows = await trx
    .select({
      salesOrderLineId: sol.id,
      ordered: sol.quantity,
      canceledBeforeShipment: lineCanceledQuantitySql(sol.id, 'before_shipment'),
      canceledAfterShipment: lineCanceledQuantitySql(sol.id, 'after_shipment'),
      canceled: lineCanceledQuantitySql(sol.id, 'any'),
      demand: lineDemandSql(sol.quantity, sol.id),
      remaining: lineRemainingSql(sol.quantity, sol.id),
      returnHeld: lineReturnHeldSql(sol.id),
    })
    .from(sol)
    .where(eq(sol.salesOrderId, salesOrderId))
    .orderBy(sol.id);
  const skuRows = await trx.execute<LineSkuRow>(sql`
    select line_sku.*
      from (${lineSkuQuantitiesSql(sql`select ${salesOrderId}::uuid`)}) as line_sku
     order by line_sku.sales_order_line_id, line_sku.sku_id
  `);
  const skusByLine = new Map<string, LineSkuQuantities[]>();
  for (const row of skuRows) {
    skusByLine.set(row.sales_order_line_id, [
      ...(skusByLine.get(row.sales_order_line_id) ?? []),
      {
        skuId: row.sku_id,
        qtyPerUnit: row.qty_per_unit,
        required: row.required,
        shipped: row.shipped,
        forwarded: row.forwarded,
        delivered: row.delivered,
        partnerCompleted: row.partner_completed,
        outstanding: row.outstanding,
        returnActive: row.return_active,
        returnConsumed: row.return_consumed,
        claimable: row.claimable,
      },
    ]);
  }
  return new Map(
    rows.map((row) => [row.salesOrderLineId, { ...row, skus: skusByLine.get(row.salesOrderLineId) ?? [] }]),
  );
}
