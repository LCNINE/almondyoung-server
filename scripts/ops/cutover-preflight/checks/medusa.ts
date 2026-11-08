// Medusa 정합 축 — core 가 이미 끝낸 줄에 Medusa 예약이 남아 있나.
//
// Medusa 예약은 Medusa fulfillment 로만 풀리는데 우리 dispatch 는 fulfillment 를 만들지 않는다. 지금은
// scripts/sellmate/clear-reservations.ts 가 셀메이트 CSV 시각 기준으로 매일 지운다. 그 스크립트를 끊은 뒤에도
// 이 값이 0 근처에 머무는 것이 #1247 의 완료 조건이다.
import type { Sql } from '../db';
import type { Report } from '../report';

export async function checkMedusaReservations(medusa: Sql, core: Sql, r: Report): Promise<void> {
  r.section('Medusa 1. 살아 있는 예약');
  const reservations = await medusa<{ line_item_id: string; quantity: number; created_at: Date }[]>`
    select line_item_id, quantity::int as quantity, created_at
    from reservation_item where deleted_at is null and line_item_id is not null`;
  const total = reservations.reduce((sum, x) => sum + x.quantity, 0);
  r.info(`살아 있는 Medusa 예약 ${reservations.length}건 · ${total}개`);
  if (!reservations.length) return;

  // core 에서 그 줄이 «끝났나» — 판매주문이 취소됐거나, 그 줄의 출고주문이 전부 끝난 상태.
  const ids = reservations.map((x) => x.line_item_id);
  const done = await core<{ channel_order_item_id: string }[]>`
    select sol.channel_order_item_id
    from sales_order_lines sol join sales_orders so on so.id = sol.sales_order_id
    where so.sales_channel = 'medusa' and sol.channel_order_item_id = any(${ids})
      and (
        so.status::text in ('canceled','cancelled')
        or (exists (select 1 from fulfillment_order_items foi where foi.sales_order_line_id = sol.id::text)
            and not exists (
              select 1 from fulfillment_order_items foi
              join fulfillment_orders fo on fo.id = foi.fulfillment_order_id
              where foi.sales_order_line_id = sol.id::text
                and fo.status::text not in ('shipped','completed','canceled'))))`;
  const doneSet = new Set(done.map((x) => x.channel_order_item_id));
  const stale = reservations.filter((x) => doneSet.has(x.line_item_id));
  const staleQty = stale.reduce((sum, x) => sum + x.quantity, 0);
  if (!stale.length) r.ok('core 가 이미 끝낸 줄에 남은 Medusa 예약 0');
  else
    r.bad(
      `core 가 이미 끝낸(출고·취소) 줄에 남은 Medusa 예약 ${stale.length}건 · ${staleQty}개 — 스토어프론트에서 이중 차감`,
      '지금은 clear-reservations 가 매일 지운다. 대체는 #1247 (판매주문 줄 예약 상태로 Medusa 예약을 맞춘다)',
    );
  const oldest = reservations.reduce((min, x) => (x.created_at < min ? x.created_at : min), reservations[0].created_at);
  r.info(`가장 오래된 살아 있는 예약 ${oldest.toISOString()} — clear-reservations 마지막 실행 이후 쌓인 것`);
}
