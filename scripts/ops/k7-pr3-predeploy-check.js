// scripts/ops/k7-pr3-predeploy-check.js
// READ ONLY. K7 PR3(상자 전 취소가 출고 명령 `UnboxedDemandCancellation` 을 부른다) — 배포 직전에 한 번, 배포 뒤에 한 번.
//   ① 열린 상자 전 FO(새 상자 줄 없음)를 fulfillment_mode × status 로 — 이 PR 의 새 경로를 지날 주문들. 10-24 실측 0
//   ② N13: 상자 전 FO 엔 예약이 없다는 전제 — 확정 예약 중 SHIPMENT_LINE 이 아니거나 FOI 를 가리키는 행 = 0 이어야 한다.
//      0 이 아니면 그 주문의 상자 전 취소는 해제 대신 500 으로 막힌다(명령이 fail-closed). 10-24 실측 0
//   ③ 롤백 판정: 상자 전 FO 중 canceled·shipped·completed 가 아닌 FO 의 canceled_qty > 0 FOI 수. 배포 전엔 0 이 정상이다.
//      (canceled FO 는 제외 — 전체취소도 canceled_qty 를 쓰지만 옛 코드는 canceled FO 를 다시 부분취소·출고하지 않아 롤백 안전)
//      배포 뒤 0 이 아니면 롤백 금지 — 옛 코드는 상자 전 FOI 의 qty 를 남은 수요로 읽어(canceled_qty 를 모른다) 취소분을 다시 판다
// «상자 전» = 그 FO 의 FOI 가 `opened_for_fulfillment_order_id IS NULL` 인 상자(V2 상자)에 하나도 오르지 않았다(`hasBoxedFulfillment` 와 같은 정의).
// 실행(사람): sst tunnel 을 띄운 뒤
//   cd deployments/lcnine/services && npx sst shell --stage live -- node -e "$(cat ../../../scripts/ops/k7-pr3-predeploy-check.js)"
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
      const unboxed = tx`
        NOT EXISTS (
          SELECT 1 FROM fulfillment_order_items f2
          JOIN shipment_lines sl ON sl.fulfillment_order_item_id = f2.id
          JOIN shipments s ON s.id = sl.shipment_id
          WHERE f2.fulfillment_order_id = fo.id AND s.opened_for_fulfillment_order_id IS NULL)`;

      const open = await tx`
        SELECT fo.fulfillment_mode::text AS mode, fo.status::text AS status, COUNT(*)::int AS n
        FROM fulfillment_orders fo
        WHERE fo.status NOT IN ('shipped', 'completed', 'canceled') AND ${unboxed}
        GROUP BY 1, 2 ORDER BY 1, 2`;
      console.log('① 열린 상자 전 FO(mode × status, 10-24 실측 없음):', open.length === 0 ? '없음' : open);

      const [reservations] = await tx`
        SELECT COUNT(*)::int AS n, COALESCE(SUM(quantity), 0)::int AS qty
        FROM stock_reservations
        WHERE status = 'confirmed'
          AND (target_type <> 'SHIPMENT_LINE' OR fulfillment_order_item_id IS NOT NULL)`;
      if (reservations.n === 0) {
        console.log('② ✓ 상자 줄이 아닌 확정 예약 0 — 상자 전 취소가 예약을 만나지 않는다(N13)');
      } else {
        console.log('② ✗ 상자 줄이 아닌 확정 예약이 있다 — 그 주문의 상자 전 취소가 500:', reservations);
        const holders = await tx`
          SELECT r.target_type, r.target_id, r.fulfillment_order_item_id, r.quantity
          FROM stock_reservations r
          WHERE r.status = 'confirmed'
            AND (r.target_type <> 'SHIPMENT_LINE' OR r.fulfillment_order_item_id IS NOT NULL)
          ORDER BY r.created_at LIMIT 20`;
        console.log('   (앞 20행)', holders);
        process.exitCode = 1;
      }

      const [rollback] = await tx`
        SELECT COUNT(*)::int AS foi, COUNT(DISTINCT fo.id)::int AS fo
        FROM fulfillment_order_items foi
        JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
        WHERE foi.canceled_qty > 0 AND fo.status NOT IN ('canceled', 'shipped', 'completed') AND ${unboxed}`;
      console.log(
        rollback.foi === 0
          ? '③ 열린 상자 전 FO 의 canceled_qty > 0 FOI 0 — 배포 전이면 정상, 배포 뒤면 아직 롤백 가능'
          : '③ 열린 상자 전 FO 의 canceled_qty > 0 FOI 가 있다 — 배포 뒤라면 롤백 금지(옛 코드가 qty 를 남은 수요로 읽는다):',
        rollback,
      );
    });
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
