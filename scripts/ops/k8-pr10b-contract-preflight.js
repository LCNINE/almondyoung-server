// scripts/ops/k8-pr10b-contract-preflight.js
// READ ONLY. K8 PR 10b(옛 반품·교환·inventory 반품 표 일곱·enum 여섯 DROP) — 머지 전 한 번, db:migrate 직전에 한 번 더.
//   ① 지울 표의 행 수 + 옛 행을 가리키던 business_links = 전부 0 이어야 한다(PR 10 이후 쓰는 코드가 없다)
//   ② 바깥 의존 = 전부 없어야 한다. DROP TABLE … CASCADE 는 다른 표의 FK·기대는 뷰·행 타입을 쓰는 칸·함수를 조용히 같이 지운다.
//      plpgsql 본문(트리거 함수 등)은 PG 가 의존을 기록하지 않아 CASCADE 도 모른다 — DROP 은 되고 그 뒤 그 함수가 매번 죽는다.
//      마이그 파일이 아는 의존은 스크래치 DB 가 잡지만, 라이브에서 손으로 만든 것은 여기서만 보인다
//   ③ 남은 표·enum 개수 — migrate 전 7·6, 뒤 0·0. 대기 마이그 판정은 `npm run deploy:preflight` 가 한다
// 실행(사람): sst tunnel 을 띄운 뒤
//   cd deployments/lcnine/services && npx sst shell --stage live -- node -e "$(cat ../../../scripts/ops/k8-pr10b-contract-preflight.js)"
// 로컬 확인: DATABASE_URL=postgres://… node scripts/ops/k8-pr10b-contract-preflight.js
// SST_RESOURCE_Db 가 있으면(sst shell) DATABASE_URL 은 무시한다 — 셸에 남은 로컬 URL 로 초록이 나오면 안 된다.
// 첫 줄 «대상» 이 라이브 core 인지 먼저 본다.
const postgres = require('postgres');

const TABLES = [
  'returns',
  'return_items',
  'return_requests',
  'return_request_items',
  'return_refund_attempts',
  'exchange_requests',
  'exchange_request_items',
];
const ENUMS = [
  'return_status',
  'return_request_status',
  'exchange_request_status',
  'return_reason_code',
  'exchange_reason_code',
  'return_refund_attempt_status',
];

function connect() {
  if (!process.env.SST_RESOURCE_Db) return postgres(process.env.DATABASE_URL, { max: 1 });
  const d = JSON.parse(process.env.SST_RESOURCE_Db);
  return postgres({
    host: process.env.DB_TUNNEL_HOST || d.host,
    port: Number(process.env.DB_TUNNEL_PORT || d.port),
    username: d.username,
    password: d.password,
    database: 'core',
    ssl: 'require',
    max: 1,
  });
}

const sql = connect();

(async () => {
  try {
    await sql.begin('read only', async (tx) => {
      const [target] = await tx`
        SELECT current_database() AS database, COALESCE(host(inet_server_addr()), 'local socket') AS server`;
      console.log('대상:', { ...target, via: process.env.SST_RESOURCE_Db ? 'SST_RESOURCE_Db' : 'DATABASE_URL' });

      const rows = {};
      for (const table of TABLES) {
        const [{ exists }] = await tx`SELECT to_regclass(${'public.' + table}) IS NOT NULL AS exists`;
        rows[table] = exists ? (await tx`SELECT COUNT(*)::int AS n FROM ${tx(table)}`)[0].n : '이미 없음';
      }
      const [links] = await tx`
        SELECT COUNT(*)::int AS n FROM business_links
        WHERE relation_name IN ('return_lifecycle_event', 'exchange_lifecycle_event')`;
      rows.business_links_legacy = links.n;
      console.log('① 행 수(게이트 = 전부 0 또는 «이미 없음»):', rows);

      const foreignKeys = await tx`
        SELECT con.conname, src.relname AS from_table, dst.relname AS to_table
        FROM pg_constraint con
        JOIN pg_class src ON src.oid = con.conrelid
        JOIN pg_class dst ON dst.oid = con.confrelid
        WHERE con.contype = 'f' AND dst.relname = ANY(${TABLES}) AND NOT (src.relname = ANY(${TABLES}))`;
      const views = await tx`
        SELECT DISTINCT v.relname AS dependent_view, t.relname AS on_table
        FROM pg_depend dep
        JOIN pg_rewrite r ON r.oid = dep.objid
        JOIN pg_class v ON v.oid = r.ev_class
        JOIN pg_class t ON t.oid = dep.refobjid
        WHERE dep.classid = 'pg_rewrite'::regclass
          AND t.relname = ANY(${TABLES}) AND v.oid <> t.oid`;
      const enumColumns = await tx`
        SELECT table_schema, table_name, column_name, udt_name
        FROM information_schema.columns
        WHERE udt_name = ANY(${ENUMS}) AND NOT (table_name = ANY(${TABLES}))`;
      const enumFunctions = await tx`
        SELECT p.proname, ty.typname
        FROM pg_proc p
        JOIN pg_type ty ON ty.oid = p.prorettype OR ty.oid = ANY(p.proargtypes::oid[])
        WHERE ty.typname = ANY(${ENUMS})`;
      const rowTypeUsers = await tx`
        SELECT DISTINCT dep.classid::regclass::text AS kind, dep.objid, t.relname AS row_type_of
        FROM pg_depend dep
        JOIN pg_class t ON t.reltype = dep.refobjid
        WHERE t.relname = ANY(${TABLES})
          AND dep.deptype = 'n'
          AND NOT (dep.classid = 'pg_class'::regclass AND dep.objid IN (SELECT oid FROM pg_class WHERE relname = ANY(${TABLES})))`;
      const rowTypeColumns = await tx`
        SELECT c.table_schema, c.table_name, c.column_name, c.udt_name
        FROM information_schema.columns c
        WHERE c.udt_name = ANY(${TABLES}) AND NOT (c.table_name = ANY(${TABLES}))`;
      // 본문에 표 이름이 나오는 함수. 'returns' 는 SQL 키워드 RETURNS 와 겹치므로 따옴표·스키마 한정·from/into/update/join/table 뒤만 본다
      const bodyMentions = await tx`
        SELECT n.nspname, p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND p.prosrc ~* ${'\\m(return_items|return_requests|return_request_items|return_refund_attempts|exchange_requests|exchange_request_items)\\M|"returns"|\\.returns\\M|\\m(from|into|update|join|table)\\s+returns\\M'}`;
      console.log('② 바깥 의존(게이트 = 전부 없음):', {
        foreignKeys: foreignKeys.length === 0 ? '없음' : foreignKeys,
        views: views.length === 0 ? '없음' : views,
        enumColumns: enumColumns.length === 0 ? '없음' : enumColumns,
        enumFunctions: enumFunctions.length === 0 ? '없음' : enumFunctions,
        rowTypeUsers: rowTypeUsers.length === 0 ? '없음' : rowTypeUsers,
        rowTypeColumns: rowTypeColumns.length === 0 ? '없음' : rowTypeColumns,
        functionBodies: bodyMentions.length === 0 ? '없음' : bodyMentions,
      });

      const [left] = await tx`
        SELECT
          (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(${TABLES}))::int AS tables,
          (SELECT COUNT(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public' AND t.typtype = 'e' AND t.typname = ANY(${ENUMS}))::int AS enums`;
      console.log('③ 남은 표·enum(migrate 전 7·6, 뒤 0·0):', left);
    });
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
