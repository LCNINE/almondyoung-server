/**
 * READ-ONLY 진단 — live `core` DB의 마이그레이션 적용 상태 확인.
 *
 * 실행:
 *   sst shell --stage live -- npx tsx scripts/verify-live-migration-state.ts
 *
 * 쓰기(INSERT/UPDATE/DDL/마이그레이션) 없음 — SELECT 전용. 확인 후 파일 삭제 가능.
 * 크리덴셜은 db-connection.ts 와 동일하게 SST_RESOURCE_Db 에서 얻음(수동 시크릿 추출 없음).
 */
import postgres from 'postgres';
import { Resource } from 'sst';

function getDbCreds() {
  const r = Resource as any;
  const name = ['Db', 'IdpDb'].find((n) => process.env[`SST_RESOURCE_${n}`]);
  if (!name) {
    throw new Error("SST Resource 없음 — 'sst shell --stage live' 안에서 실행하세요.");
  }
  const d = r[name];
  return {
    host: d.host as string,
    port: d.port as number,
    username: d.username as string,
    password: d.password as string,
  };
}

async function main() {
  const c = getDbCreds();
  // 접속 파라미터는 옵션 객체로 전달(URL 쿼리로 넘기면 postgres.js가 서버 GUC로 오전달).
  // core 서비스는 논리 DB 'core' 사용 (service-registry.ts). RDS는 TLS 필수 → ssl:'require'(인증서 미검증).
  const sql = postgres({
    host: c.host,
    port: c.port,
    username: c.username,
    password: c.password,
    database: 'core',
    ssl: 'require',
    max: 1,
  });
  try {
    console.log('\n== (a) 최근 적용 마이그레이션 (drizzle.__drizzle_migrations) ==');
    try {
      const migs = await sql<{ created_at: string; hash16: string }[]>`
        SELECT created_at, left(hash, 16) AS hash16
        FROM drizzle.__drizzle_migrations
        ORDER BY created_at DESC
        LIMIT 6`;
      console.table(migs.map((m) => ({ created_at: String(m.created_at), hash16: m.hash16 })));
    } catch (e: any) {
      console.log('  drizzle.__drizzle_migrations 조회 실패:', e?.message);
      const t = await sql`SELECT schemaname, tablename FROM pg_tables WHERE tablename LIKE '%drizzle%'`;
      console.log('  drizzle 관련 테이블 후보:', t);
    }

    console.log('\n== (b) product-import 적용 여부 (NOT NULL / 1 이어야 정상) ==');
    const pi = await sql`
      SELECT to_regclass('public.product_import_items')::text AS product_import_items,
             (SELECT 1 FROM pg_type WHERE typname = 'product_import_item_status') AS import_enum`;
    console.log(' ', pi[0]);

    console.log('\n== (c) outbound_task 테이블 (둘 다 null = 삭제됨, 정상) ==');
    const ot = await sql`
      SELECT to_regclass('public.outbound_tasks')::text AS outbound_tasks,
             to_regclass('public.outbound_task_lines')::text AS outbound_task_lines,
             to_regclass('public.outbound_task_items')::text AS outbound_task_items,
             to_regclass('public.outbound_task_orders')::text AS outbound_task_orders`;
    console.log(' ', ot[0]);

    console.log('\n== (d) event_type enum (행 없음 = 삭제됨, 정상) ==');
    const et = await sql`SELECT typname FROM pg_type WHERE typname = 'event_type'`;
    console.log(' ', et.length ? et : '(없음 — 정상)');
    console.log('');
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
