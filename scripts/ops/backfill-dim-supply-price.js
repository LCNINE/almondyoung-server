// analytics dim_product_masters.supply_price 백필 — 게시(active) 버전의 공급가를 core 에서 읽어
// analytics dim 에 채운다. 이벤트 계약에 supplyPrice 가 실리기 전에 게시된 상품들을 위한 1회성.
//
// 실행 (deployments/lcnine/services 에서, DB 터널 127.0.0.1:15432):
//   DB_TUNNEL_HOST=127.0.0.1 DB_TUNNEL_PORT=15432 \
//   npx sst shell --stage live -- node ../../../scripts/ops/backfill-dim-supply-price.js
// DRY_RUN=1 이면 변경 건수만 보고하고 쓰지 않는다.
const { Client } = require('pg');

function resource(name) {
  return JSON.parse(process.env[`SST_RESOURCE_${name}`]);
}
function dbUrl(name) {
  const d = resource('Db');
  return `postgresql://${d.username}:${d.password}@${process.env.DB_TUNNEL_HOST || d.host}:${process.env.DB_TUNNEL_PORT || d.port}/${name}?sslmode=disable`;
}

async function main() {
  const dryRun = process.env.DRY_RUN === '1';
  const core = new Client({ connectionString: process.env.CORE_DATABASE_URL || dbUrl('core') });
  const analytics = new Client({ connectionString: process.env.ANALYTICS_DATABASE_URL || dbUrl('analytics') });
  await core.connect();
  await analytics.connect();

  const { rows } = await core.query(`
    SELECT v.master_id, v.name, v.supply_price
    FROM product_master_versions v
    JOIN product_masters m ON m.id = v.master_id AND m.deleted_at IS NULL
    WHERE v.status = 'active' AND v.deleted_at IS NULL
  `);
  const withCost = rows.filter((r) => r.supply_price != null);
  console.log(`core active 버전 ${rows.length}건, 원가 보유 ${withCost.length}건`);

  let updated = 0;
  let inserted = 0;
  let unchanged = 0;
  for (const row of withCost) {
    if (dryRun) {
      const existing = await analytics.query('SELECT supply_price FROM dim_product_masters WHERE master_id = $1', [
        row.master_id,
      ]);
      if (existing.rowCount === 0) inserted += 1;
      else if (String(existing.rows[0].supply_price) !== String(row.supply_price)) updated += 1;
      else unchanged += 1;
      continue;
    }
    // 이벤트가 이미 최신 원가를 실어 왔을 수 있다 — 값이 다를 때만 갱신해 updated_at 을 아낀다
    const result = await analytics.query(
      `INSERT INTO dim_product_masters (master_id, name, supply_price, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())
       ON CONFLICT (master_id) DO UPDATE
         SET supply_price = EXCLUDED.supply_price, updated_at = now()
         WHERE dim_product_masters.supply_price IS DISTINCT FROM EXCLUDED.supply_price
       RETURNING (xmax = 0) AS is_insert`,
      [row.master_id, row.name ?? null, row.supply_price],
    );
    if (result.rowCount === 0) unchanged += 1;
    else if (result.rows[0].is_insert) inserted += 1;
    else updated += 1;
  }

  console.log(
    `${dryRun ? '[DRY_RUN] ' : ''}insert ${inserted}건, update ${updated}건, 변화 없음 ${unchanged}건 (원가 없는 상품 ${rows.length - withCost.length}건은 건드리지 않음)`,
  );
  await core.end();
  await analytics.end();
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
