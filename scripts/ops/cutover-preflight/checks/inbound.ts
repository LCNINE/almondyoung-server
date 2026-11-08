// 입고 축 (core) — 앱 입고가 돈 적 있나, 셀메이트 CSV 가 만든 가짜 발주가 열려 있나, 입고예정일의 원천.
import type { Sql } from '../db';
import type { Report } from '../report';

// scripts/sellmate/load-inbound-from-csv.ts 가 발주에 남기는 표지.
const CSV_TAG = 'sellmate-csv-inbound%';

export async function checkInbound(tx: Sql, r: Report): Promise<void> {
  r.section('입고 1. 앱 입고 이력');
  const [usage] = await tx<{ receipts: number; receive_events: number; last_receive: Date | null }[]>`
    select (select count(*) from inbound_receipts)::int as receipts,
           (select count(*) from stock_events where transition_type = 'RECEIVE')::int as receive_events,
           (select max(occurred_at) from stock_events where transition_type = 'RECEIVE') as last_receive`;
  if (usage.receive_events > 0)
    r.ok(`RECEIVE 원장 ${usage.receive_events}건 (마지막 ${usage.last_receive?.toISOString() ?? '-'})`);
  else r.info('앱 입고(RECEIVE)가 한 번도 돌지 않았다 — 입고는 아직 셀메이트에서만 한다');

  r.section('입고 2. 셀메이트 CSV 가 만든 열린 발주 라인');
  // 이 라인들은 셀메이트 입고예정을 비춘 거울이다. 컷오버 뒤 앱의 입고예정 목록을 가짜로 채운다.
  const [csv] = await tx<{ lines: number; eta_past: number }[]>`
    select count(*)::int as lines, count(*) filter (where pol.expected_arrival < current_date)::int as eta_past
    from purchase_order_lines pol join purchase_orders po on po.id = pol.po_id
    where po.audit_notes like ${CSV_TAG} and pol.closed_at is null`;
  if (csv.lines === 0) r.ok('셀메이트 CSV 발주의 열린 라인 0');
  else
    r.bad(
      `셀메이트 CSV 발주의 열린 라인 ${csv.lines}줄(예정일 지남 ${csv.eta_past}줄)`,
      '컷오버 직전에 닫는다 (#1243). 그 전까지는 스토어프론트 입고예정일의 원천이라 그대로 둔다',
    );

  r.section('입고 3. 스토어프론트 입고예정일의 원천');
  // product-restock.ts: 발주 라인 예정일 + 품목별 수동 restockDate. 선적 원천은 #1240 이 더한다.
  const [restock] = await tx<{ with_inbound_date: number; manual_restock: number }[]>`
    select (select count(*) from product_sellable_quantity_projections where inbound_date is not null)::int as with_inbound_date,
           (select count(*) from sales_variant_policies where restock_date is not null)::int as manual_restock`;
  r.info(`입고예정일이 있는 variant ${restock.with_inbound_date}개 · 수동 재입고일 ${restock.manual_restock}개`);
  r.info('셀메이트를 끊으면 CSV 발주 원천이 멈춘다 — 선적(입고리스트) 원천은 #1240');
}
