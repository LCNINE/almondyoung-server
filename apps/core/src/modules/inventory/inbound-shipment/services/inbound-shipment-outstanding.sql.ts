import { sql, SQL } from 'drizzle-orm';
import { wmsTables } from '../../schema/inventory.schema';

const line = wmsTables.inboundShipmentLines;
const shipment = wmsTables.inboundShipments;
const lineBox = wmsTables.inboundShipmentLineBoxes;
const box = wmsTables.inboundShipmentBoxes;
const count = wmsTables.inboundShipmentBoxCounts;

/**
 * 선적 «오는 중» 수량 공식(설계 §5) — 외부 선적만 센다. 1.5단계가 내부 선적을 만들면 여기서 뺀다(설계 §12).
 * 상세 화면(`InboundShipmentReader.detail`)의 줄별 (예정 − 센 수량)과 같은 식이고,
 * 파리티는 `inbound-shipment-outstanding.integration.spec.ts` 의 `matches detail view line remainders` 가 고정한다.
 * Nest 밖 순수 함수다(모듈 순환 회피, 설계 §5.2). 호출자가 inbound_shipments 를 조인해야 한다.
 */
export function outstandingShipmentQtySql(): SQL<number> {
  return sql<number>`GREATEST(${line.expectedQty} - COALESCE((SELECT SUM(${count.countedQty}) FROM ${count} WHERE ${count.lineId} = ${line.id} AND ${count.canceledAt} IS NULL), 0), 0)::int`;
}

/** 오는 중인 줄: sku 줄 · 선적 expected/receiving · 열린 입고용 상자가 하나라도 남음 · 잔량 > 0. 외부 선적 조건은 아직 없다. */
export function outstandingShipmentLineWhere(): SQL {
  return sql`${line.kind} = 'sku'
    AND ${shipment.status} IN ('expected', 'receiving')
    AND EXISTS (SELECT 1 FROM ${lineBox} JOIN ${box} ON ${box.id} = ${lineBox.boxId} WHERE ${lineBox.lineId} = ${line.id} AND ${box.disposition} = 'stock' AND ${box.status} = 'open')
    AND ${outstandingShipmentQtySql()} > 0`;
}
