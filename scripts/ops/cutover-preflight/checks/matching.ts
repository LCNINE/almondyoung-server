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
}
