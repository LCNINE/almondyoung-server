// Medusa 정합 축 — core 가 이미 끝낸 줄에 Medusa 예약이 남아 있나.
//
// Medusa 예약은 Medusa fulfillment 로만 풀리는데 우리 dispatch 는 fulfillment 를 만들지 않는다. 지금은
// scripts/sellmate/clear-reservations.ts 가 셀메이트 CSV 시각 기준으로 매일 지운다. 그 스크립트를 끊은 뒤에도
// 이 값이 0 근처에 머무는 것이 #1247 의 완료 조건이다.
import { reservationTarget } from '../../../../apps/channel-adapter/src/services/reservation-projection/reservation-target';
import type { Sql } from '../db';
import type { Report } from '../report';
import { reservationAxisFindings, reservationMismatches, type RecountLine } from '../rules';

export async function checkMedusaReservations(medusa: Sql, core: Sql, adapter: Sql | null, r: Report): Promise<void> {
  const cutoverAt = adapter ? await readCutoverAt(adapter) : null;
  await checkProjectionAxis(medusa, core, adapter, cutoverAt, r);
  await checkLiveReservations(medusa, core, cutoverAt, r);
}

async function readCutoverAt(adapter: Sql): Promise<Date | null> {
  const [row] = await adapter<{ cutover_at: Date | null }[]>`
    select cutover_at from reservation_projection_settings where id = 'singleton'`;
  return row?.cutover_at ?? null;
}

// 투영 축(#1247) — T·멈춘 회차·크론 신선도·«Medusa 예약 ≠ 목표».
// 재계산은 앱과 같은 reservationTarget 을 쓴다. heldUnits 는 core 의 줄 수량 조각(line-quantities.sql)이 정하는데
// 그걸 SQL 로 옮기면 정의가 두 벌이 되므로, 판단이 모호하지 않은 줄만 센다:
//   core 주문(medusa 채널, T 이후, 끝나지 않은 상태)이고 출고주문 항목이 하나도 없는 줄 → heldUnits = 0.
//   demand = 주문 수량 − 출고 전 취소(sales_order_cancellation_lines.shipment_phase = 'before_shipment').
//   Medusa 예약이 살아 있는 줄만 본다(Medusa 가 재고를 관리하지 않는 줄은 예약이 없어 not_managed 와 구별이 안 된다).
// 출고가 시작된 줄은 core 의 heldUnits 정의가 필요해 여기서 세지 않는다 — 앱의 대사 회차가 그 줄을 본다.
async function checkProjectionAxis(
  medusa: Sql,
  core: Sql,
  adapter: Sql | null,
  cutoverAt: Date | null,
  r: Report,
): Promise<void> {
  r.section('Medusa 0. 예약 투영 (#1247)');
  if (!adapter) {
    r.info('channel_adapter 에 닿지 못해 투영 축을 건너뜀 — services 에서 sst shell 로 돌린다');
    return;
  }
  const [halted] = await adapter<{ n: number }[]>`
    select count(*)::int as n from medusa_reservation_reconcile_runs where status = 'halted' and closed_at is null`;
  const [last] = await adapter<{ finished_at: Date | null; status: string }[]>`
    select finished_at, status from medusa_reservation_reconcile_runs order by started_at desc limit 1`;
  // 신선도는 끝까지 돈 회차로 본다 — 매일 skipped(core·Medusa 읽기 실패)면 크론은 돌아도 아무것도 맞추지 않았다.
  const lastFinished = await adapter<{ finished_at: Date }[]>`
    select finished_at from medusa_reservation_reconcile_runs
    where finished_at is not null and status in ('applied', 'halted') order by started_at desc limit 1`;

  let mismatches = 0;
  if (cutoverAt) {
    // reservation_item.quantity 는 재고 단위다. 목표는 판매 단위라 variant 재고 연결의 required_quantity 로 나눈다
    // (Medusa 조회 라우트 GET /admin/line-item-reservations 와 같은 환산).
    const reserved = await medusa<{ line_item_id: string; quantity: number }[]>`
      select r.line_item_id,
             sum(r.quantity / coalesce(nullif(pvii.required_quantity, 0), 1))::int as quantity
      from reservation_item r
      join order_line_item li on li.id = r.line_item_id
      left join product_variant_inventory_item pvii
        on pvii.variant_id = li.variant_id and pvii.inventory_item_id = r.inventory_item_id and pvii.deleted_at is null
      where r.deleted_at is null and r.line_item_id is not null
      group by r.line_item_id`;
    const rows = reserved.length
      ? await core<{ channel_order_item_id: string; ordered: number; canceled: number }[]>`
          select sol.channel_order_item_id, sol.quantity::int as ordered,
                 coalesce((select sum(cl.quantity) from sales_order_cancellation_lines cl
                           where cl.sales_order_line_id = sol.id and cl.shipment_phase = 'before_shipment'), 0)::int as canceled
          from sales_order_lines sol join sales_orders so on so.id = sol.sales_order_id
          where so.sales_channel = 'medusa' and so.order_date >= ${cutoverAt}
            and so.status::text not in ('cancelled', 'shipped', 'delivered', 'timeout')
            and sol.channel_order_item_id = any(${reserved.map((x) => x.line_item_id)})
            and not exists (select 1 from fulfillment_order_items foi where foi.sales_order_line_id = sol.id::text)`
      : [];
    const current = new Map(reserved.map((x) => [x.line_item_id, x.quantity]));
    const lines: RecountLine[] = rows.map((x) => ({
      lineItemId: x.channel_order_item_id,
      ordered: x.ordered,
      canceledBeforeShipment: x.canceled,
      current: current.get(x.channel_order_item_id) ?? 0,
    }));
    const bad = reservationMismatches(lines, reservationTarget);
    mismatches = bad.length;
    r.info(`재계산 범위: T 이후·출고 시작 전 ${lines.length}줄 (출고가 시작된 줄은 앱 대사가 본다)`);
    r.info('예약 수량은 required_quantity 로 나눠 판매 단위로 맞춰 비교한다');
    r.info(
      '이 재계산은 Medusa 예약이 살아 있는 줄만 본다 — «목표 > 0 인데 예약이 없음»(과판매 방향)은 못 잡는다. 그 방향은 앱 대사의 core 후보 쪽이 본다',
    );
    for (const l of bad.slice(0, 5)) r.info(`  어긋남 예: ${l.lineItemId} 현재 ${l.current} / 주문 ${l.ordered} − 취소 ${l.canceledBeforeShipment}`);
  }
  for (const f of reservationAxisFindings({
    phase: r.phase,
    cutoverAt,
    openHalted: halted?.n ?? 0,
    lastFinishedAt: lastFinished[0]?.finished_at ?? null,
    lastRunning: last?.status === 'running',
    now: new Date(),
    mismatches,
  })) {
    if (f.level === 'ok') r.ok(f.msg);
    else if (f.level === 'info') r.info(f.msg);
    else r.bad(f.msg, f.fix ?? '#1247');
  }
}

async function checkLiveReservations(medusa: Sql, core: Sql, cutoverAt: Date | null, r: Report): Promise<void> {
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
      and (${cutoverAt}::timestamptz is null or so.order_date >= ${cutoverAt})
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
  // T 가 있으면 T 이후 주문으로 좁힌다 — 그 앞 주문은 투영이 끝까지 건드리지 않고 clear-reservations 의 몫이었다.
  if (!stale.length) r.ok('core 가 이미 끝낸 줄에 남은 Medusa 예약 0' + (cutoverAt ? ' (T 이후 주문)' : ''));
  else
    r.bad(
      `core 가 이미 끝낸(출고·취소) 줄에 남은 Medusa 예약 ${stale.length}건 · ${staleQty}개 — 스토어프론트에서 이중 차감`,
      '지금은 clear-reservations 가 매일 지운다. 대체는 #1247 (판매주문 줄 예약 상태로 Medusa 예약을 맞춘다)',
    );
  const oldest = reservations.reduce((min, x) => (x.created_at < min ? x.created_at : min), reservations[0].created_at);
  r.info(`가장 오래된 살아 있는 예약 ${oldest.toISOString()} — clear-reservations 마지막 실행 이후 쌓인 것`);
}
