/**
 * A-0 준비(READ-ONLY): #452 재동기화 대상/검증 지표 산출. 라이브 변경 없음.
 * - Core: fulfillment_kind='digital' active master 목록
 * - channel_adapter: pim_medusa_mappings 로 medusa_product_id 매핑
 * - Medusa: 현재 상태 집계(fulfillmentKind 마킹/프로필/projection requires_shipping) = 재동기화 전/후 검증 지표
 */
import postgres from 'postgres';
import { Resource } from 'sst';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function wr<T>(l: string, fn: () => Promise<T>): Promise<T> {
  let e: any; for (let i = 1; i <= 6; i++) { try { return await fn(); } catch (x: any) { e = x; console.error(`(${l} ${i}/6 ${x.code ?? x.message})`); await sleep(1200 * i); } } throw e;
}
async function main() {
  const db = (Resource as any).Db;
  const mk = (d: string) => postgres({ host: db.host, port: db.port, username: db.username, password: db.password, database: d, ssl: 'require', max: 1, connect_timeout: 30 });
  const core = mk('core'), ca = mk('channel_adapter'), med = mk('medusa');
  await wr('warm', () => core`SELECT 1`);
  try {
    console.log('=== 1) Core: digital active master ===');
    const masters = await core`
      SELECT DISTINCT pmv.master_id, pmv.name
      FROM product_master_versions pmv
      WHERE pmv.fulfillment_kind = 'digital' AND pmv.status = 'active'`;
    const masterIds = (masters as any[]).map((m) => m.master_id);
    console.log(`digital active master: ${masterIds.length}개`);

    console.log('\n=== 2) channel_adapter: medusa 매핑 ===');
    const maps = await ca`
      SELECT pim_master_id, medusa_product_id, medusa_handle
      FROM pim_medusa_mappings
      WHERE pim_master_id = ANY(${masterIds}) AND medusa_product_id IS NOT NULL`;
    const medIds = (maps as any[]).map((m) => m.medusa_product_id);
    console.log(`매핑된 medusa product: ${medIds.length}개 (미매핑 ${masterIds.length - medIds.length}개)`);

    console.log('\n=== 3) Medusa 현재 상태 집계 (재동기화 전 baseline / 후 검증용) ===');
    const agg = await med`
      SELECT
        count(*)::int total,
        count(*) FILTER (WHERE p.metadata->>'fulfillmentKind' = 'digital')::int marked_digital,
        count(*) FILTER (WHERE p.metadata->>'fulfillmentKind' IS NULL)::int no_fk,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM product_shipping_profile psp WHERE psp.product_id=p.id AND psp.deleted_at IS NULL))::int has_profile
      FROM product p WHERE p.id = ANY(${medIds})`;
    console.log('product 집계:', JSON.stringify((agg as any[])[0]));
    const proj = await med`
      SELECT count(DISTINCT ii.id)::int projection_requires_shipping_true
      FROM inventory_item ii
      JOIN product_variant_inventory_item pvii ON pvii.inventory_item_id=ii.id AND pvii.deleted_at IS NULL
      JOIN product_variant v ON v.id=pvii.variant_id
      JOIN product p ON p.id=v.product_id
      WHERE p.id = ANY(${medIds}) AND ii.requires_shipping=true AND ii.deleted_at IS NULL AND ii.sku LIKE 'psq_%'`;
    console.log('projection inventory(requires_shipping=true):', JSON.stringify((proj as any[])[0]));

    console.log('\n=== 4) dry-run 후보 1건 (마킹 누락 + 매핑됨) ===');
    const cand = await med`
      SELECT p.id medusa_id, p.title, p.metadata->>'fulfillmentKind' fk
      FROM product p
      WHERE p.id = ANY(${medIds}) AND p.metadata->>'fulfillmentKind' IS NULL
      ORDER BY p.title LIMIT 3`;
    for (const c of cand as any[]) console.log('  후보:', JSON.stringify(c));

    console.log('\n=== 5) backfill 필터용 masterId (처음 5개 + 총수) ===');
    console.log('총', masterIds.length, '개. 예:', masterIds.slice(0, 5));
  } finally {
    await core.end({ timeout: 5 }).catch(() => {}); await ca.end({ timeout: 5 }).catch(() => {}); await med.end({ timeout: 5 }).catch(() => {});
  }
}
main().catch((e) => { console.error('ERR', e?.message ?? e); process.exit(1); });
