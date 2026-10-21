import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { lineCanceledQuantitySql, lineDemandSql, lineRemainingSql } from './line-quantities.sql';

export type LineQuantities = {
  salesOrderLineId: string;
  ordered: number;
  canceledBeforeShipment: number;
  canceledAfterShipment: number;
  /** 갈래 무관 합 — «남은 수량» 계산용. */
  canceled: number;
  /** ordered − canceledBeforeShipment. */
  demand: number;
  /** ordered − canceled — 더 취소할 수 있는 판매 단위의 상한. */
  remaining: number;
};

/**
 * 판매주문의 라인별 수량을 읽는 문 (K6 PR2a). 호출자 트랜잭션에서 읽는다(ADR-0025).
 * 그 주문의 모든 판매 라인이 키로 있다 — 취소가 없는 라인도 0 으로 나온다(빠지면 소비자의 `?? 0` 이 오류를 숨긴다).
 * 칼럼은 전부 `line-quantities.sql.ts` 의 조각에서 select 한다 — 여기서 산술하지 않는다.
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
    })
    .from(sol)
    .where(eq(sol.salesOrderId, salesOrderId))
    .orderBy(sol.id);
  return new Map(rows.map((row) => [row.salesOrderLineId, row]));
}
