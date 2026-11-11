// 마켓 축 — 채널 활성·리스팅(core), 수집 상태·격리(channel_adapter).
import type { Sql } from '../db';
import type { Report } from '../report';

const MARKETS = ['naver', 'coupang'] as const;

export async function checkMarketCore(tx: Sql, r: Report): Promise<void> {
  r.section('마켓 1. 판매 채널·리스팅 (core)');
  const channels = await tx<{ site: string; is_active: boolean; listings: number }[]>`
    select c.site, c.is_active, count(l.id)::int as listings
    from sales_channels c left join channel_variant_listings l on l.sales_channel_id = c.id
    group by 1, 2 order by 1`;
  r.table(channels);
  for (const site of MARKETS) {
    const row = channels.find((c) => c.site === site);
    // 채널은 컷오버 시각 T 에 켠다(런북 #1251). 그 전엔 꺼져 있는 게 맞다 — 행이 있는지만 본다.
    if (!row) r.bad(`${site} 판매 채널 행이 없다`, `admin-web 판매 채널에 ${site} 를 만든다(비활성으로) — #1244/#1245`);
    else r.info(`${site}: ${row.is_active ? '활성' : '비활성(T 에 켠다)'} · 리스팅 ${row.listings}개(그때그때 매핑)`);
  }
}

export async function checkMarketAdapter(tx: Sql, r: Report): Promise<void> {
  r.section('마켓 2. 채널별 수집 상태 (channel_adapter sync_statuses)');
  // last_sync_at 은 하트비트가 아니다 — 처리한 항목이 있을 때만 갱신된다. 살아 있는지는 updated_at.
  r.table(
    await tx`
      select channel_id, data_type, status, last_sync_at, updated_at, failed_syncs,
             left(coalesce(last_error_message, ''), 60) as last_error
      from sync_statuses order by channel_id, data_type`,
  );

  r.section('마켓 3. 열린 수집 격리 (사람 몫)');
  const open = await tx<{ channel: string; reason: string; n: number; last_at: Date }[]>`
    select channel, reason, count(*)::int as n, max(created_at) as last_at
    from order_collection_failures where status = 'quarantined'
    group by 1, 2 order by 3 desc`;
  r.table(open);
  const recent = await tx<{ n: number }[]>`
    select count(*)::int as n from order_collection_failures
    where status = 'quarantined' and created_at > now() - interval '3 days'`;
  if (recent[0].n === 0) r.ok('최근 3일 새로 격리된 주문 0');
  else r.bad(`최근 3일 새로 격리된 주문 ${recent[0].n}건`, 'admin-web 격리함에서 매핑 생성 → 자동 재처리');
}

/**
 * 컷오버 뒤: 쿠팡에서 수집돼 어댑터가 매핑을 만든 지 30분이 지났는데 core 판매주문에 없는 주문 수.
 * 이벤트(OrderCreated)가 core 에서 거절되면 매핑만 남는다. 두 DB 라 id 목록을 core 로 가져가 비교한다.
 */
export async function checkCoupangCollectedHasCoreOrder(core: Sql, adapter: Sql, r: Report): Promise<void> {
  r.section('마켓 4. 쿠팡 수집분이 core 판매주문으로 이어졌나 (channel_adapter → core)');
  const mapped = await adapter<{ channel_order_id: string }[]>`
    select channel_order_id from wms_order_mappings
    where sales_channel = 'coupang' and created_at < now() - interval '30 minutes'`;
  if (mapped.length === 0) {
    r.info('30분 지난 쿠팡 수집 매핑 0 — 비교할 것이 없다');
    return;
  }
  const ids = mapped.map((m) => m.channel_order_id);
  const present = await core<{ channel_order_id: string }[]>`
    select channel_order_id from sales_orders
    where sales_channel = 'coupang' and channel_order_id = any(${ids})`;
  const have = new Set(present.map((p) => p.channel_order_id));
  const missing = ids.filter((id) => !have.has(id)).length;
  if (missing === 0) r.ok(`쿠팡 수집 매핑 ${ids.length}건 모두 core 판매주문이 있다`);
  else r.bad(`쿠팡 수집 매핑 ${missing}건이 core 판매주문에 없다`, 'DLQ 화면에서 OrderCreated 거절 사유 확인 (#1245)');
}
