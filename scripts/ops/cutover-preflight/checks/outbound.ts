// 출고 축 — 옛 scripts/ops/outbound-cutover-preflight.ts 의 core·channel_adapter 검사를 그대로 옮겼다.
// 판정 조건은 코드에서 옮겼다(각 검사 옆 주석의 파일이 정본이다 — 코드가 바뀌면 여기도 바꾼다).
import type { Sql } from '../db';
import type { Report } from '../report';

const OPEN_SHIPMENT = `s.status in ('draft','planned')`;

export async function checkOutbound(tx: Sql, r: Report): Promise<void> {
  r.section('출고 1. 창고 — 판매 창고에 discrete 피킹이 켜져 있나');
  // outbound-batch-orchestrator.service.ts: 창고 supported_picking_strategies 에 방식의 전략이 없으면
  // OUTBOUND_BATCH_METHOD_NOT_SUPPORTED(409). 단순출고는 individual(=discrete) 배치만 연다.
  const warehouses = await tx<{ name: string; is_sellable: boolean; supported_picking_strategies: string[] | null }[]>`
    select name, is_sellable, supported_picking_strategies from warehouses order by is_sellable desc, name`;
  r.table(warehouses);
  const sellable = warehouses.filter((w) => w.is_sellable);
  if (!sellable.length) r.bad('판매 창고가 0곳', 'admin-web 창고 화면에서 출고 창고의 판매를 켠다');
  for (const w of sellable) {
    const strategies = w.supported_picking_strategies ?? [];
    if (strategies.includes('discrete')) r.ok(`${w.name}: discrete 켜짐`);
    else
      r.bad(`${w.name}: discrete 꺼짐 → 배치 생성 409`, 'admin-web 창고 화면 «피킹 방식» 에서 개별피킹을 켠다 (#545)');
  }

  r.section('출고 2. 배송 프로필 — 계획 확정(draft→planned)의 선행조건');
  // shipment-planning.service.ts assertPlanProfile: 스냅샷 3개가 비어 있지 않은 객체,
  // carrier_account_ref 공백 아님, supported_fulfillment_modes 가 in_house 포함.
  const profiles = await tx`
    select name,
      coalesce(jsonb_typeof(sender_snapshot) = 'object' and sender_snapshot <> '{}'::jsonb, false) as sender,
      coalesce(jsonb_typeof(origin_address_snapshot) = 'object' and origin_address_snapshot <> '{}'::jsonb, false) as origin,
      coalesce(jsonb_typeof(return_address_snapshot) = 'object' and return_address_snapshot <> '{}'::jsonb, false) as return,
      coalesce(btrim(carrier_account_ref) <> '', false) as carrier_account,
      coalesce('in_house' = any(supported_fulfillment_modes::text[]), false) as in_house
    from delivery_profiles order by name`;
  r.table(profiles);
  const complete = profiles.filter((p) => p.sender && p.origin && p.return && p.carrier_account && p.in_house);
  if (complete.length) r.ok(`완전한 배송 프로필 ${complete.length}개`);
  else
    r.bad(
      '완전한 배송 프로필이 없다 → 모든 상자가 SHIPMENT_PROFILE_INCOMPATIBLE/CONFIGURATION_INCOMPLETE 로 draft 에 갇힌다',
      '배송 프로필 생성 경로가 코드에 없다(API·화면 0). 생성 수단 + 한진 실계약번호(carrier_account_ref) 필요 (#1233)',
    );

  // 열린 상자의 SKU 가 프로필을 갖고 있나. 한 상자의 SKU 는 전부 같은 프로필이어야 한다.
  const [skuCoverage] = await tx`
    select count(distinct sl.sku_id)::int as open_skus,
           count(distinct sl.sku_id) filter (where k.delivery_profile_id is null)::int as missing_profile,
           count(distinct sl.sku_id) filter (where k.stock_type = 'drop_shipped')::int as drop_shipped
    from shipments s
    join shipment_lines sl on sl.shipment_id = s.id
    join skus k on k.id = sl.sku_id
    where ${tx.unsafe(OPEN_SHIPMENT)}`;
  r.info(`열린 상자(draft·planned)의 SKU ${skuCoverage.open_skus}개`);
  if (skuCoverage.missing_profile === 0) r.ok('열린 상자 SKU 전부 delivery_profile_id 있음');
  else
    r.bad(
      `열린 상자 SKU 중 delivery_profile_id 없음 ${skuCoverage.missing_profile}개`,
      'SKU 에 배송 프로필을 연결한다 — 건별은 SKU 수정(PATCH /inventory/skus/:id)으로 되고, 일괄 백필은 보류 중 (#1233)',
    );
  const [mixedProfile] = await tx`
    select count(*)::int as n from (
      select s.id from shipments s
      join shipment_lines sl on sl.shipment_id = s.id
      join skus k on k.id = sl.sku_id
      where ${tx.unsafe(OPEN_SHIPMENT)}
      group by s.id having count(distinct k.delivery_profile_id) > 1) x`;
  if (mixedProfile.n) r.bad(`SKU 프로필이 섞인 열린 상자 ${mixedProfile.n}개`, '상자 분할 또는 SKU 프로필 통일');
  if (skuCoverage.drop_shipped)
    r.info(`열린 상자에 직배송 SKU ${skuCoverage.drop_shipped}개 — V2 계획 확정 불가(설계)`);

  r.section('출고 3. 상자 상태·수취인');
  r.table(await tx`select status, count(*)::int from shipments group by 1 order by 2 desc`);
  // shipment-planning.service.ts assertRecipientComplete 의 5개 필드
  const [recipient] = await tx`
    select count(*)::int as n from shipments s
    where ${tx.unsafe(OPEN_SHIPMENT)} and exists (
      select 1 from unnest(array['recipientName','phone','postalCode','roadAddress','detailAddress']) k
      where coalesce(btrim(s.recipient_snapshot ->> k), '') = '')`;
  if (recipient.n === 0) r.ok('열린 상자의 수취인 5필드 전부 채워짐');
  else
    r.bad(
      `수취인 필드가 빈 열린 상자 ${recipient.n}개 → SHIPMENT_RECIPIENT_INCOMPLETE`,
      '수취인 정정(reviseRecipient). Medusa 주소의 address_2·phone 공백이 원인일 수 있다',
    );

  r.section('출고 4. 예약 — 열린 상자는 라인별 확정 예약 = 수량이어야 한다');
  // shipment-reservation.service.ts / shipment-planning.service.ts assertFullyReserved
  const [reservation] = await tx`
    select count(distinct s.id)::int as open_shipments,
           count(distinct s.id) filter (where coalesce(r.confirmed, 0) <> sl.qty)::int as not_exact
    from shipments s
    join shipment_lines sl on sl.shipment_id = s.id
    left join (
      select shipment_line_id, sum(quantity)::int as confirmed from stock_reservations
      where status = 'confirmed' and shipment_line_id is not null group by 1) r on r.shipment_line_id = sl.id
    where ${tx.unsafe(OPEN_SHIPMENT)}`;
  r.info(
    `열린 상자 ${reservation.open_shipments}개 중 예약 불일치 ${reservation.not_exact}개 (재고 부족이면 정상일 수 있다)`,
  );

  // 유령 예약: 이미 끝난 출고주문(셀메이트로 나간 것)에 붙은 확정 예약. dispatch 를 안 거쳐 안 풀렸다.
  const ghosts = await tx`
    select fo.status as fo_status, count(*)::int as reservations, sum(r.quantity)::int as qty,
           count(distinct r.sku_id)::int as skus
    from stock_reservations r
    join shipment_lines sl on sl.id = r.shipment_line_id
    join fulfillment_order_items foi on foi.id = sl.fulfillment_order_item_id
    join fulfillment_orders fo on fo.id = foi.fulfillment_order_id
    where r.status = 'confirmed' and fo.status in ('shipped','completed','canceled')
    group by 1 order by 3 desc`;
  if (!ghosts.length) r.ok('끝난 출고주문에 붙은 확정 예약 0');
  else {
    r.table(ghosts);
    r.bad(
      '끝난 출고주문에 확정 예약이 남아 재고를 묶고 있다(유령 예약)',
      'ShipmentReservationService.releasePartial 로 해제 (#1233). ReservationLifecycleService 는 SHIPMENT_LINE 을 못 본다',
    );
  }
  const [negative] = await tx`select count(*)::int as n from stock_summary_view where available_qty < 0`;
  // 유령 예약이 0 인데도 음수면 이중 차감이다 — sync-stock 이 ON_HAND 를 「셀메이트 재고 − 미발송 주문 수」로
  // 맞추는데 core 도 같은 미발송 주문에 확정 예약을 들고 있다.
  if (negative.n)
    r.bad(
      `가용재고가 음수인 SKU·창고 ${negative.n}개`,
      ghosts.length
        ? '유령 예약 해제(close-shipped-shipments.ts) 후 다시 판정 (#1233)'
        : '유령 예약은 0 — sync-stock 과 core 예약의 이중 차감. 컷오버 때 실사는 안 한다(#1233 결정) — 컷오버 뒤 실사로 재확인',
    );
  else r.ok('가용재고 음수 0');

  r.section('출고 5. 채널 식별자 — 없으면 dispatch 409 SHIPMENT_EVENT_IDENTITY_MISSING');
  // shipment-dispatch.service.ts: medusa·naver·coupang 라인은 판매주문 라인·channel_order_item_id·channel_order_id 필수
  const [identity] = await tx`
    select count(distinct s.id)::int as n from shipments s
    join shipment_lines sl on sl.shipment_id = s.id
    join fulfillment_order_items foi on foi.id = sl.fulfillment_order_item_id
    join fulfillment_orders fo on fo.id = foi.fulfillment_order_id
    join sales_orders so on so.id = fo.sales_order_id
    left join sales_order_lines sol on sol.id::text = foi.sales_order_line_id
    where ${tx.unsafe(OPEN_SHIPMENT)}
      and so.sales_channel in ('medusa','naver','coupang')
      and (sol.id is null or coalesce(btrim(sol.channel_order_item_id), '') = ''
           or coalesce(btrim(so.channel_order_id), '') = '')`;
  if (identity.n === 0) r.ok('열린 상자의 채널 식별자 전부 있음');
  else
    r.bad(`채널 식별자가 빠진 열린 상자 ${identity.n}개`, '원 주문에서 channel_order_item_id 백필 필요(이슈 미발행)');

  r.section('출고 6. 출고주문 생성 대기열');
  r.table(
    await tx`select status, count(*)::int, max(updated_at) as last_updated
             from fulfillment_order_creation_backlogs group by 1 order by 2 desc`,
  );
  // 이미 셀메이트로 나간 주문(판매주문 shipped·delivered·취소)의 행은 출고할 게 아니라 닫을 대상이다.
  const [matching] = await tx<{ open: number; done: number }[]>`
    select count(*) filter (where so.status::text not in ('shipped','delivered','canceled','cancelled'))::int as open,
           count(*) filter (where so.status::text in ('shipped','delivered','canceled','cancelled'))::int as done
    from fulfillment_order_creation_backlogs b join sales_orders so on so.id = b.sales_order_id
    where b.status = 'awaiting_matching'`;
  if (matching.open)
    r.bad(
      `아직 안 나간 주문의 매칭 대기 ${matching.open}건 — 출고주문으로 못 간다`,
      'admin-web /order/matching 에서 SKU 매칭',
    );
  else r.ok('아직 안 나간 주문의 매칭 대기 0');
  if (matching.done) r.dayOf(`이미 끝난 주문의 매칭 대기 ${matching.done}건`, '출고할 게 아니라 닫는다 (#1243)');
  const failed = await tx`
    select coalesce(failure_reason, '(null)') as failure_reason, count(*)::int
    from fulfillment_order_creation_backlogs where status = 'failed' group by 1 order by 2 desc limit 10`;
  if (failed.length) {
    r.table(failed);
    r.info('failed 는 종결 없이 최대 15분 간격으로 영원히 재시도한다(혼합 SKU 등)');
  }

  r.section('출고 7. 출고 깔때기 — 한 번이라도 돌았나');
  // 배치 피킹이 돈 적 있나 = 시작된 배치(started_at)와 작업 항목 배정 행. 피킹 계획 테이블은 ADR-0041 로 사라졌다.
  r.table(await tx`select status, count(*)::int from fulfillment_orders group by 1 order by 2 desc`);
  const funnel = await tx`
    select 'outbound_batches' as t, status::text, count(*)::int from outbound_batches group by 2
    union all select 'work_items', status::text, count(*)::int from outbound_batch_work_items group by 2
    union all select 'batch_start', case when started_at is null then 'not_started' else 'started' end,
                     count(*)::int from outbound_batches group by 2
    union all select 'picking_allocations', case when work_item_id is null then 'legacy' else 'work_item' end,
                     count(*)::int from picking_source_allocations group by 2
    union all select 'waybills', status::text || '/' || source::text, count(*)::int from waybills group by 2
    union all select 'dispatch_attempts', status::text, count(*)::int from dispatch_attempts group by 2
    order by 1, 3 desc`;
  r.table(funnel);
  r.table(
    await tx`select transition_type, count(*)::int, max(occurred_at) as last_at
             from stock_events group by 1 order by 2 desc`,
  );
  const [journals] = await tx`select count(*)::int as n from stock_journals`;
  r.info(`stock_journals ${journals.n}행 (정식 원장 경로는 journal 을 먼저 꽂는다)`);
  const [sellmate] = await tx<{ last_at: Date | null; n: number }[]>`
    select max(occurred_at) as last_at, count(*)::int as n from stock_events where reason = 'sellmate-sync'`;
  r.info(
    `셀메이트 재고 sync 마지막 실행 ${sellmate.last_at?.toISOString() ?? '없음'} (누적 ${sellmate.n}건) — 컷오버 후엔 이 값이 멈춰야 한다`,
  );
  // sync-stock 은 절대값 수렴이라 컷오버 뒤 한 번만 돌아도 우리 원장(SHIP·RECEIVE)을 되돌린다.
  if (r.cutoverAt && sellmate.last_at && sellmate.last_at > r.cutoverAt)
    r.bad(
      `셀메이트 재고 sync 가 컷오버 시각 뒤(${sellmate.last_at.toISOString()})에 돌았다 — 원장이 셀메이트 값으로 덮였다`,
      '즉시 sync 를 멈추고, 그 뒤의 앱 출고·입고분을 원장과 대조한다 (#1251 런북)',
    );
  else if (r.cutoverAt) r.ok('컷오버 시각 뒤 셀메이트 재고 sync 없음');
  const [scriptShipped] = await tx`
    select count(*)::int as n from fulfillment_orders fo
    where fo.status = 'shipped' and not exists (
      select 1 from fulfillment_order_items foi
      join shipment_lines sl on sl.fulfillment_order_item_id = foi.id
      join dispatch_attempts da on da.shipment_id = sl.shipment_id
      where foi.fulfillment_order_id = fo.id)`;
  r.info(`dispatch 없이 shipped 인 출고주문 ${scriptShipped.n}건 = 셀메이트 스크립트가 마감한 것`);

  r.section('출고 8. 판매 채널');
  r.table(
    await tx`
      select c.site, c.is_active, count(l.id)::int as listings,
             count(l.id) filter (where l.is_active)::int as active_listings
      from sales_channels c left join channel_variant_listings l on l.sales_channel_id = c.id
      group by 1, 2 order by 1`,
  );
  r.info('naver·coupang 은 listings 가 0 이면 수집돼도 전 라인 격리된다');
}

export async function checkOutboundAdapter(tx: Sql, r: Report): Promise<void> {
  r.section('출고 9. 채널 수집 격리 (channel_adapter)');
  r.table(
    await tx`
      select channel, status, reason, count(*)::int, max(created_at) as last_at
      from order_collection_failures group by 1, 2, 3 order by 4 desc limit 20`,
  );
}
