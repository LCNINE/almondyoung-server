// scripts/ops/k7-pr4-predeploy-check.js
// READ ONLY. K7 PR4(환불 방침 — 환불 필터가 «환불 결정 전·실패» 를 본다, 환불 안 함 결정) — 배포 직전에 한 번, 배포 뒤에 한 번.
//   ① 이 PR 로 필터에 새로 걸리는 주문: status <> 'cancelled' 이고 닫히지 않은 manual_pending 환불 링크가 있는 판매주문 수(채널별)
//      + 그 링크 created_at 최소·최대. 배포하면 «환불 결정 전·실패» 목록에 이만큼이 새로 뜬다.
//   ② sales_channel = '3pl' 판매주문 수(상태별) — D1·D2 가 닿는 주문. 0 이 예상.
//   ③ 환불 링크 refundStatus 별 행 수 — 배포 전 requested·waived 0 이 정상.
// 실행(사람): sst tunnel 을 띄운 뒤
//   cd deployments/lcnine/services && npx sst shell --stage live -- node -e "$(cat ../../../scripts/ops/k7-pr4-predeploy-check.js)"
const postgres = require('postgres');
const d = JSON.parse(process.env.SST_RESOURCE_Db);
const sql = postgres({
  host: process.env.DB_TUNNEL_HOST || d.host,
  port: Number(process.env.DB_TUNNEL_PORT || d.port),
  username: d.username,
  password: d.password,
  database: 'core',
  ssl: 'require',
  max: 1,
});

(async () => {
  try {
    await sql.begin('read only', async (tx) => {
      const newlyListed = await tx`
        SELECT so.sales_channel::text AS channel, COUNT(DISTINCT so.id)::int AS orders,
               MIN(mp.created_at) AS oldest_link, MAX(mp.created_at) AS newest_link
        FROM sales_orders so
        JOIN business_links mp
          ON mp.source_type = 'sales_order' AND mp.source_id = so.id
         AND mp.relation_name = 'cancellation_linked_wallet_refund'
         AND mp.metadata->>'refundStatus' = 'manual_pending'
        WHERE so.status <> 'cancelled'
          AND NOT EXISTS (
            SELECT 1 FROM business_links c
            WHERE c.relation_name = 'cancellation_linked_wallet_refund'
              AND c.metadata->>'refundStatus' IN ('succeeded', 'waived')
              AND c.metadata->>'completedRefundLinkId' = mp.id::text)
        GROUP BY 1 ORDER BY 1`;
      console.log(
        '① 필터에 새로 걸리는 주문(취소 전 + 닫히지 않은 manual_pending, 채널별):',
        newlyListed.length === 0 ? '없음' : newlyListed,
      );

      const threePl = await tx`
        SELECT status::text AS status, COUNT(*)::int AS n
        FROM sales_orders WHERE sales_channel = '3pl'
        GROUP BY 1 ORDER BY 1`;
      console.log('② 3pl 판매주문(상태별, 0 이 예상):', threePl.length === 0 ? '없음' : threePl);

      const links = await tx`
        SELECT metadata->>'refundStatus' AS refund_status, COUNT(*)::int AS n
        FROM business_links
        WHERE relation_name = 'cancellation_linked_wallet_refund'
        GROUP BY 1 ORDER BY 1`;
      console.log('③ 환불 링크 refundStatus 별 행 수:', links);
      const fresh = links.filter((r) => r.refund_status === 'requested' || r.refund_status === 'waived');
      console.log(
        fresh.length === 0
          ? '   ✓ requested·waived 0 — 배포 전이면 정상'
          : '   requested·waived 가 있다 — 배포 전이면 이상, 배포 뒤면 새 경로가 돈 흔적:',
        fresh,
      );
    });
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
