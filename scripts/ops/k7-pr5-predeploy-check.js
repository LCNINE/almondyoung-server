// scripts/ops/k7-pr5-predeploy-check.js
// READ ONLY. K7 PR5(직배송 «알릴 취소» 대기함 — 넘긴 직배 주문의 취소가 업체에 알릴 한 줄을 남긴다) — 배포 직전에 한 번, 배포 뒤에 한 번.
//   ① fulfillment_mode='drop_ship' AND direct_ship_status='forwarded' 인 FO 수(FO status 별) — 배포 뒤 취소가 대기 행을 남길 대상.
//   ② 그중 owner_id IS NULL 수 — 0 이어야 배포한다(N29: 업체 없는 행은 대기함에 못 선다).
//   ③ 넘긴 직배 FO 중 FOI canceled_qty > 0 인 FO 수 — 이미 통지 없이 지나간 취소. 대기함엔 안 뜬다, 운영자가 따로 확인.
//   ④ 배포 뒤: direct_ship_cancel_notices 존재·행 수(전체/미통지). 배포 전엔 «테이블 없음» 이 정상.
// 실행(사람): sst tunnel 을 띄운 뒤
//   cd deployments/lcnine/services && npx sst shell --stage live -- node -e "$(cat ../../../scripts/ops/k7-pr5-predeploy-check.js)"
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
      const forwarded = await tx`
        SELECT status::text AS status, COUNT(*)::int AS n
        FROM fulfillment_orders
        WHERE fulfillment_mode = 'drop_ship' AND direct_ship_status = 'forwarded'
        GROUP BY 1 ORDER BY 1`;
      console.log('① 넘긴 직배 FO(상태별):', forwarded.length === 0 ? '없음' : forwarded);

      const [{ n: noOwner }] = await tx`
        SELECT COUNT(*)::int AS n
        FROM fulfillment_orders
        WHERE fulfillment_mode = 'drop_ship' AND direct_ship_status = 'forwarded' AND owner_id IS NULL`;
      console.log(
        noOwner === 0
          ? '② ✓ owner_id 없는 넘긴 직배 FO 0 — 배포해도 된다'
          : `② ✗ owner_id 없는 넘긴 직배 FO ${noOwner}건 — 0 이 되기 전에 배포하지 않는다(N29)`,
      );

      const [{ n: alreadyCanceled }] = await tx`
        SELECT COUNT(DISTINCT fo.id)::int AS n
        FROM fulfillment_orders fo
        JOIN fulfillment_order_items foi ON foi.fulfillment_order_id = fo.id
        WHERE fo.fulfillment_mode = 'drop_ship' AND fo.direct_ship_status = 'forwarded'
          AND foi.canceled_qty > 0`;
      console.log(
        `③ 넘긴 직배 FO 중 이미 취소 수량이 있는 FO: ${alreadyCanceled}건` +
          (alreadyCanceled > 0 ? ' — 통지 없이 지나갔다. 대기함에 안 뜨니 운영자가 따로 확인' : ''),
      );

      const [{ exists }] = await tx`SELECT to_regclass('public.direct_ship_cancel_notices') IS NOT NULL AS exists`;
      if (!exists) {
        console.log('④ direct_ship_cancel_notices 없음 — 배포(마이그) 전이면 정상');
      } else {
        const [counts] = await tx`
          SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE notified_at IS NULL)::int AS open
          FROM direct_ship_cancel_notices`;
        console.log('④ direct_ship_cancel_notices 존재 — 전체/미통지:', counts);
      }
    });
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
