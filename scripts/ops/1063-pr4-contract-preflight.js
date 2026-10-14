// scripts/ops/1063-pr4-contract-preflight.js
// READ ONLY. #1063 PR 4(옛 라인 매칭 칸 DROP) — 머지·배포 직전, 그리고 db:migrate 직전에 한 번 더.
//   ① 스펙 §9.5 게이트: FO 항목이 있는데 출처 NULL 이고 남은 단위가 있는 라인 = 0 이어야 한다
//   ② 지울 칸의 값 — 680행 안팎의 product_matching_id 는 variant_id 로 다시 얻을 수 있는 주소라 버린다
//   ③ 지울 칸·테이블에 기대는 뷰 = 없어야 한다(있으면 DROP COLUMN 이 실패한다)
//   ④ core 적용 마이그 수 — migrate 전 116 이어야 한다(117 이면 이미 적용됨, 116 미만이면 남의 마이그가 밀려 있다)
// 실행(사람): sst tunnel 을 띄운 뒤
//   cd deployments/lcnine/services && npx sst shell --stage live -- node -e "$(cat ../../../scripts/ops/1063-pr4-contract-preflight.js)"
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
      const [gate] = await tx`
        WITH per_line AS (
          SELECT l.id, SUM(foi.qty - foi.canceled_qty) AS live_units
          FROM sales_order_lines l
          JOIN fulfillment_order_items foi ON foi.sales_order_line_id = l.id::text
          WHERE l.composition_source IS NULL
          GROUP BY l.id)
        SELECT COUNT(*)::int AS all_null_with_fo,
               COUNT(*) FILTER (WHERE live_units > 0)::int AS gate_live_units_gt0
        FROM per_line`;
      console.log('① FO 있고 출처 NULL 라인(게이트 = gate_live_units_gt0 = 0):', gate);

      const [cols] = await tx`
        SELECT COUNT(*)::int AS remaining FROM information_schema.columns
        WHERE (table_name = 'sales_order_lines' AND column_name IN ('product_matching_id', 'mapping_snapshot_id'))
           OR (table_name = 'fulfillment_order_items' AND column_name = 'mapping_snapshot_id')`;
      if (cols.remaining > 0) {
        const [old] = await tx`
          SELECT
            (SELECT COUNT(*) FROM sales_order_lines WHERE product_matching_id IS NOT NULL)::int AS sol_product_matching_id,
            (SELECT COUNT(*) FROM sales_order_lines WHERE mapping_snapshot_id IS NOT NULL)::int AS sol_mapping_snapshot_id,
            (SELECT COUNT(*) FROM fulfillment_order_items WHERE mapping_snapshot_id IS NOT NULL)::int AS foi_mapping_snapshot_id,
            (SELECT COUNT(*) FROM product_sku_mapping_snapshots)::int AS snapshot_rows`;
        console.log('② 지울 칸의 값:', old);
      } else {
        console.log('② 칸이 이미 없다 — 마이그가 적용됐다');
      }

      const deps = await tx`
        SELECT DISTINCT c.relname AS dependent_view, t.relname AS on_table, a.attname AS col
        FROM pg_depend dep
        JOIN pg_class t ON t.oid = dep.refobjid
        LEFT JOIN pg_attribute a ON a.attrelid = dep.refobjid AND a.attnum = dep.refobjsubid
        JOIN pg_rewrite r ON r.oid = dep.objid
        JOIN pg_class c ON c.oid = r.ev_class
        WHERE dep.classid = 'pg_rewrite'::regclass
          AND ((t.relname = 'sales_order_lines' AND a.attname IN ('product_matching_id', 'mapping_snapshot_id'))
            OR (t.relname = 'fulfillment_order_items' AND a.attname = 'mapping_snapshot_id')
            OR t.relname = 'product_sku_mapping_snapshots')`;
      console.log('③ 뷰 의존(없어야 한다):', deps.length === 0 ? '없음' : deps);

      const [mig] = await tx`SELECT COUNT(*)::int AS applied FROM drizzle.__drizzle_migrations`;
      console.log('④ core 적용 마이그(migrate 전 116):', mig);
    });
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
