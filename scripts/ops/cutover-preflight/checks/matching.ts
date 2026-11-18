// 매칭 축 (core) — 판매 중인데 SKU 가 없는 variant, 매칭이 생겼는데도 깨어나지 않은 대기열 행.
import type { Sql } from '../db';
import type { Report } from '../report';

export async function checkMatching(tx: Sql, r: Report): Promise<void> {
  r.section('매칭 1. 판매 불가 사유가 매칭인 variant');
  // 컷오버 뒤엔 미매칭 주문을 그때그때 매칭한다(#1233 결정) — 그래서 ✗ 가 아니라 규모만 본다.
  r.table(
    await tx`
      select reason, count(*)::int as variants from product_sellable_quantity_projections
      where reason in ('MATCHING_MISSING','MATCHING_PENDING') group by 1 order by 1`,
  );

  r.section('매칭 2. 매칭이 생겼는데도 깨어나지 않은 출고주문 생성 대기열');
  // 기다리던 variant 가 전부 matched 링크를 가졌는데도 awaiting_matching 에 남은 행.
  const rows = await tx<{ so_status: string; n: number }[]>`
    with b as (
      select id, sales_order_id, waiting_variant_ids as w from fulfillment_order_creation_backlogs
      where status = 'awaiting_matching' and jsonb_array_length(coalesce(waiting_variant_ids, '[]'::jsonb)) > 0)
    select so.status::text as so_status, count(*)::int as n
    from b join sales_orders so on so.id = b.sales_order_id
    where not exists (
      select 1 from jsonb_array_elements_text(b.w) v
      where not exists (
        select 1 from product_matchings m join product_variant_sku_links l on l.product_matching_id = m.id
        where m.variant_id = v::uuid and m.status = 'matched'))
    group by 1 order by 2 desc`;
  r.table(rows);
  // 이미 셀메이트로 나간 주문(shipped·delivered)은 깨우면 안 된다 — 닫을 대상(#1243).
  const live = rows.filter((x) => !['shipped', 'delivered', 'canceled', 'cancelled'].includes(x.so_status));
  const stuck = live.reduce((sum, x) => sum + x.n, 0);
  if (stuck === 0) r.ok('아직 안 나간 주문 중 매칭이 있는데 멈춘 대기열 행 0');
  else r.bad(`아직 안 나간 주문 중 매칭이 있는데 멈춘 대기열 행 ${stuck}건`, '깨우는 경로 버그 (#1242)');
  const closed = rows.filter((x) => !live.includes(x)).reduce((sum, x) => sum + x.n, 0);
  if (closed) r.info(`이미 끝난 주문의 같은 행 ${closed}건 — 깨우지 말고 닫는다 (#1243)`);

  r.section('매칭 3. 위탁 업체 화주 — 위탁 SKU 가 자사 화주로 남아 있지 않은가');
  // 어느 SKU 가 위탁인지는 레포 밖 업체 파일이 정본이라, 여기선 옮긴 흔적(위탁 화주의 SKU)만 본다.
  // 화주는 누구 물건인지, 매칭은 자사몰에서 파는지를 정한다 — 매칭된 위탁 SKU 는 위탁판매라 막지 않는다.
  const holders = await tx<{ name: string; skus: number; matched: number }[]>`
    select h.name, count(s.id)::int as skus,
      count(s.id) filter (where exists (select 1 from product_variant_sku_links l where l.sku_id = s.id))::int as matched
    from holders h left join skus s on s.holder_id = h.id and s.is_deleted = false
    where not h.is_our_asset group by h.id order by 2 desc`;
  r.table(holders);
  const moved = holders.reduce((sum, h) => sum + h.skus, 0);
  if (moved > 0) r.ok(`위탁 화주 ${holders.length}곳에 SKU ${moved}개`);
  else
    r.bad(
      '위탁 화주의 SKU 가 0 → 위탁 재고가 자사 재고로 잡혀 보충 제안에 섞인다',
      'scripts/sellmate/assign-consignment-holders.ts 로 업체 파일을 반영한다 (#1334)',
    );
  const sold = holders.reduce((sum, h) => sum + h.matched, 0);
  if (sold)
    r.info(`자사몰에 매칭된 위탁 SKU ${sold}개 — 위탁판매가 맞는지 확인한다(사입이면 업체 칸 자사 로 되돌린다)`);
}
