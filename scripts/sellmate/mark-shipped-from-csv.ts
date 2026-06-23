/**
 * 셀메이트에 입력한 주문들을 core sales_orders 에서 'shipped'(출고완료)로 일괄 변경.
 * 물류 미연동 기간 동안 고객 셀프취소를 막기 위한 수동 운영 스크립트.
 *
 * 사용법 (deployments/lcnine/services 에서):
 *   # dry-run (대상만 확인)
 *   npx sst shell --stage live -- npx tsx ../../../scripts/sellmate/mark-shipped-from-csv.ts <csv경로>
 *   # 실제 적용
 *   npx sst shell --stage live -- npx tsx ../../../scripts/sellmate/mark-shipped-from-csv.ts <csv경로> --apply
 *
 * CSV 5번째 컬럼 주문번호(YYYYMMDD-{displayId}) 의 displayId 를 medusa order.display_id 로 매핑,
 * medusa order.id = core sales_orders.channel_order_id 로 연결하여 status='pending' 인 것만 'shipped' 로 변경.
 * (취소/이미출고 건은 status 조건으로 자동 제외)
 */
import postgres from 'postgres';
import { Resource } from 'sst';
import { readFileSync } from 'fs';

const csvPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!csvPath) {
  console.error('CSV 경로를 인자로 넘겨주세요.');
  process.exit(1);
}

function conn(database: string) {
  const db = (Resource as any).Db;
  return postgres({
    host: db.host, port: db.port, username: db.username, password: db.password,
    database, ssl: 'require', max: 1, connect_timeout: 30,
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: any;
  for (let i = 1; i <= 5; i++) {
    try { return await fn(); }
    catch (e: any) {
      lastErr = e;
      console.log(`  (${label} 재시도 ${i}/5: ${e.code ?? e.message})`);
      await sleep(1500 * i);
    }
  }
  throw lastErr;
}

async function main() {
  const csv = readFileSync(csvPath, 'utf8');
  const idset = new Set<number>();
  for (const m of csv.matchAll(/\b\d{8}-(\d+)\b/g)) idset.add(Number(m[1]));
  const displayIds = [...idset].sort((a, b) => a - b);
  console.log(`CSV 주문번호(display_id) ${displayIds.length}개:`, displayIds.join(', '));
  if (!displayIds.length) { console.log('주문번호를 찾지 못함. 종료.'); return; }

  const morders = await withRetry('medusa', async () => {
    const m = conn('medusa');
    try {
      await m`SELECT 1`;
      return await m`
        SELECT id, display_id, status, canceled_at, is_draft_order, deleted_at
        FROM "order" WHERE display_id = ANY(${displayIds}) ORDER BY display_id`;
    } finally { await m.end({ timeout: 5 }).catch(() => {}); }
  });
  const found = new Set((morders as any[]).map((o) => o.display_id));
  const missing = displayIds.filter((d) => !found.has(d));
  if (missing.length) console.log('⚠️ medusa에 없는 display_id:', missing.join(', '));
  const canceled = (morders as any[]).filter((o) => o.canceled_at || o.status === 'canceled');
  if (canceled.length) console.log('ℹ️ medusa상 취소:', canceled.map((o) => o.display_id).join(', '));
  const orderIds = (morders as any[]).filter((o) => !o.is_draft_order && !o.deleted_at).map((o) => o.id);
  console.log(`매칭된 medusa order: ${orderIds.length}건`);
  if (!orderIds.length) { console.log('매칭된 주문 없음. 종료.'); return; }

  await withRetry('core', async () => {
    const core = conn('core');
    try {
      await core`SELECT 1`;
      const cur = await core`
        SELECT status, count(*) AS cnt FROM sales_orders
        WHERE channel_order_id = ANY(${orderIds}) GROUP BY status ORDER BY cnt DESC`;
      console.log('=== 매칭된 sales_orders 현재 상태 ==='); console.table(cur);

      if (!APPLY) {
        const w = await core`SELECT count(*) AS cnt FROM sales_orders
          WHERE channel_order_id = ANY(${orderIds}) AND status='pending'`;
        console.log(`\n[DRY-RUN] 업데이트 예정(pending→shipped): ${(w as any)[0].cnt}건 — 적용하려면 --apply`);
        return;
      }
      const before = await core`SELECT status, count(*) AS cnt FROM sales_orders GROUP BY status ORDER BY cnt DESC`;
      console.log('=== BEFORE (전체) ==='); console.table(before);
      const updated = await core`
        UPDATE sales_orders SET status='shipped', updated_at=now()
        WHERE channel_order_id = ANY(${orderIds}) AND status='pending' RETURNING id`;
      console.log(`\n>>> UPDATED ${(updated as any[]).length} rows: pending -> shipped`);
      const after = await core`SELECT status, count(*) AS cnt FROM sales_orders GROUP BY status ORDER BY cnt DESC`;
      console.log('=== AFTER (전체) ==='); console.table(after);
    } finally { await core.end({ timeout: 5 }).catch(() => {}); }
  });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
