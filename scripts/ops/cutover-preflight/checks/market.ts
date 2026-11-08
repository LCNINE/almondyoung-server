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
