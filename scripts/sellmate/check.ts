/**
 * core DB 준비 상태 점검 (import/sync 전 사전 확인용).
 * 테이블 존재 + 기본 홀더/창고/로케이션 시드 여부 + 로케이션이 해당 창고 소속인지 확인한다.
 * 무엇이든 빠지면 non-zero 로 종료한다 (run.sh 가 실패를 감지하도록).
 *
 *   bash scripts/sellmate/run.sh live check apps/core/tmp/   (경로 인자는 무시)
 *   DATABASE_URL=... npx tsx scripts/sellmate/check.ts
 */
import postgres from 'postgres';

const NEED = [
  'skus',
  'sku_groups',
  'sku_barcodes',
  'holders',
  'warehouses',
  'locations',
  'stock_events',
  'stock_ledgers',
] as const;
const HOLDER = '019d0001-0000-7000-a000-000000000001';
const BUCHEON = '019d0001-0001-7000-a000-000000000001';
const BUCHEON_RECEIVING = '019d0002-0001-7000-a000-000000000001';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 필요 (run.sh 로 실행하면 자동 주입)');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN ${sql(NEED as unknown as string[])}
    `;
    const have = new Set(rows.map((r) => r.table_name));
    const missing = NEED.filter((t) => !have.has(t));

    console.log('📋 테이블/시드 점검\n');
    for (const t of NEED) {
      let cnt: number | string = 'N/A(테이블없음)';
      if (have.has(t)) {
        const res = await sql.unsafe<{ c: number }[]>(`SELECT count(*)::int AS c FROM ${t}`);
        cnt = res[0].c;
      }
      console.log(`  ${t.padEnd(14)}: ${cnt}`);
    }

    if (missing.length) {
      console.error(`\n❌ 누락 테이블: ${missing.join(', ')} → 마이그레이션 안 됨. 이 stage 는 import 불가.`);
      process.exit(1);
    }

    const [h] = await sql`SELECT 1 FROM holders WHERE id=${HOLDER}`;
    const [w] = await sql`SELECT 1 FROM warehouses WHERE id=${BUCHEON}`;
    const [l] = await sql<{ warehouse_id: string }[]>`SELECT warehouse_id FROM locations WHERE id=${BUCHEON_RECEIVING}`;
    const locInWarehouse = !!l && l.warehouse_id === BUCHEON;

    console.log('\n준비 상태:');
    console.log(`  기본 홀더        : ${h ? '✅' : '❌ → import 시 FK 실패. 시드 필요'}`);
    console.log(`  부천 물류창고    : ${w ? '✅' : '❌ → sync 시 FK 실패. 시드 필요'}`);
    console.log(
      `  부천 입고기본존  : ${
        !l
          ? '❌ → sync 시 FK 실패. 시드 필요'
          : locInWarehouse
            ? '✅'
            : `❌ → 로케이션이 부천 창고 소속이 아님(warehouse_id=${l.warehouse_id}). 시드 불일치`
      }`,
    );

    if (h && w && locInWarehouse) {
      console.log('\n✅ import/sync 실행 준비 완료.');
    } else {
      console.error('\n⚠️ 시드 누락/불일치 — LAUNCH.md 의 "시드 누락 시" 절차 참고.');
      process.exit(1);
    }
  } catch (e) {
    console.error('실패:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  } finally {
    await sql.end();
  }
}
void main();
