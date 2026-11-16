// 입고 축 (core) — 앱 입고가 돈 적 있나, 셀메이트 CSV 가 만든 가짜 발주가 열려 있나, 입고예정일의 원천.
import type { Sql } from '../db';
import type { Report } from '../report';
import { overdueShipmentFix } from '../rules';

// «오는 중» 선적 줄 식(입고 3·5)은 apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment-outstanding.sql.ts
// 와 같아야 한다 — 그 파일이 정본이다. 이 스크립트는 raw postgres SQL 이라 drizzle 조각을 import 할 수 없어 텍스트로 옮겼다(설계 §5.2).
// 정본이 바뀌면 아래 OUTSTANDING_LINES 도 같이 고친다.
const OUTSTANDING_LINES = `
  select l.id as line_id, l.sku_id, s.warehouse_id
  from inbound_shipment_lines l
  join inbound_shipments s on s.id = l.shipment_id
  where l.kind = 'sku'
    and s.status in ('expected', 'receiving')
    and exists (select 1 from inbound_shipment_line_boxes lb join inbound_shipment_boxes b on b.id = lb.box_id
                where lb.line_id = l.id and b.disposition = 'stock' and b.status = 'open')
    and greatest(l.expected_qty - coalesce((select sum(c.counted_qty) from inbound_shipment_box_counts c
                                            where c.line_id = l.id and c.canceled_at is null), 0), 0)::int > 0`;

// 지워진 load-inbound-from-csv(#1240)가 발주에 남긴 표지.
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
    r.dayOf(
      `셀메이트 CSV 발주의 열린 라인 ${csv.lines}줄(예정일 지남 ${csv.eta_past}줄)`,
      '#1240 배포 뒤 scripts/ops/close-sellmate-csv-inbound.ts 로 닫는다',
    );

  r.section('입고 3. 스토어프론트 입고예정일의 원천');
  // product-restock.ts: 발주 라인 예정일 + 품목별 수동 restockDate + 선적(#1240, 외부 선적의 «오는 중»).
  const [restock] = await tx<
    { with_inbound_date: number; manual_restock: number; open_shipments: number; outstanding_skus: number }[]
  >`
    select (select count(*) from product_sellable_quantity_projections where inbound_date is not null)::int as with_inbound_date,
           (select count(*) from sales_variant_policies where restock_date is not null)::int as manual_restock,
           (select count(*) from inbound_shipments where status in ('expected', 'receiving'))::int as open_shipments,
           (select count(distinct sku_id) from (${tx.unsafe(OUTSTANDING_LINES)}) o)::int as outstanding_skus`;
  r.info(`입고예정일이 있는 variant ${restock.with_inbound_date}개 · 수동 재입고일 ${restock.manual_restock}개`);
  r.info(`열린 선적 ${restock.open_shipments}건 · «오는 중» SKU ${restock.outstanding_skus}개 (선적 원천, #1240)`);

  r.section('입고 4. 비판매 창고 재고');
  // 중국 창고 등 우리 밖 창고는 ON_HAND 가 0 이어야 한다. 아니면 선적 잔량과 같은 물건을 두 번 센다(설계 §11 🔴).
  // 비판매 창고 = sellable-warehouses.ts 의 정의(is_sellable = true 의 반대).
  const [nonSellable] = await tx<{ qty: number }[]>`
    select coalesce(sum(sl.qty), 0)::int as qty
    from stock_ledgers sl join warehouses w on w.id = sl.warehouse_id
    where w.is_sellable = false and sl.stock_state = 'ON_HAND'`;
  if (nonSellable.qty === 0) r.ok('비판매 창고 ON_HAND 0');
  else r.bad(`비판매 창고 ON_HAND 합 ${nonSellable.qty}`, '선적 잔량과 두 번 센다 — 설계 #1240 §11');

  r.section('입고 5. 선적과 겹치는 실발주');
  // CSV 표지가 아닌 열린 발주 라인이 «오는 중» 선적과 같은 SKU 를 덮으면 보충 제안이 두 번 센다(설계 §11 🔴).
  const [overlap] = await tx<{ lines: number }[]>`
    select count(*)::int as lines
    from purchase_order_lines pol join purchase_orders po on po.id = pol.po_id
    where coalesce(po.audit_notes, '') not like ${CSV_TAG}
      and po.status <> 'cancelled'
      and pol.closed_at is null and pol.status = 'ordered'
      and pol.received_qty < coalesce(pol.ordered_qty, 0)
      and pol.sku_id in (select sku_id from (${tx.unsafe(OUTSTANDING_LINES)}) o)`;
  if (overlap.lines === 0) r.ok('열린 선적과 SKU 가 겹치는 CSV 밖 열린 발주 라인 0');
  else r.bad(`열린 선적과 SKU 가 겹치는 CSV 밖 열린 발주 라인 ${overlap.lines}줄`, '발주 잔량과 선적 잔량을 두 번 센다 — 설계 #1240 §11, 보충 제안이 두 번 센다');

  r.section('입고 6. 예정일 지난 열린 선적');
  const overdue = await tx<{ name: string; expected_arrival: string; boxes_received: number; boxes_stock: number }[]>`
    select s.name, s.expected_arrival::text as expected_arrival,
           (select count(*) from inbound_shipment_boxes b where b.shipment_id = s.id and b.disposition = 'stock' and b.status <> 'open')::int as boxes_received,
           (select count(*) from inbound_shipment_boxes b where b.shipment_id = s.id and b.disposition = 'stock')::int as boxes_stock
    from inbound_shipments s
    where s.status in ('expected', 'receiving') and s.expected_arrival < (now() at time zone 'Asia/Seoul')::date
    order by s.expected_arrival`;
  if (overdue.length === 0) r.ok('예정일 지난 열린 선적 0');
  else {
    for (const o of overdue) {
      const msg = `선적 «${o.name}» 예정일 ${o.expected_arrival} 지남 (받은 상자 ${o.boxes_received}/${o.boxes_stock})`;
      if (r.phase === 'after') r.bad(msg, overdueShipmentFix('after'));
      else r.dayOf(msg, overdueShipmentFix('before'));
    }
  }
}
