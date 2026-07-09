/**
 * match-sku-to-variant.ts — 셀메이트 sku ↔ Medusa variant SKU 구성 매칭 (일괄)
 *
 * 경로: 셀메이트(카페코드+바코드) → Medusa variant(barcode 앞8=카페코드) → pimVariantId
 *       → core product_matchings(pending) → resolve 를 직접 SQL 로 재현.
 * 1차는 단일옵션 상품만 (옵션 모호성 0).
 *
 * 매칭 = admin "SKU 구성 매칭" 과 동일한 3테이블 변경:
 *   1) product_matchings: strategy='variant', status='matched', is_resolved=true, 정책
 *   2) product_variant_sku_links: (matching_id, sku_id, quantity=1) insert
 *   3) sales_variant_policies: variant 정책 upsert
 * ⚠️ 후속 recalc(sellable)·Kafka 발행은 하지 않는다 — DB 매칭까지만. (별도 처리)
 *
 * 사용:
 *   ... match-sku-to-variant.ts <csv> [--limit N] [--apply]
 *   기본 dry-run(rollback). --limit 로 소량. --apply 로 커밋.
 *
 * ENV: CORE_DB_URL, MEDUSA_DB_URL
 */
import * as postgresNs from 'postgres';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import * as Papa from 'papaparse';

const postgres = (postgresNs as any).default ?? postgresNs;
const onlyDigits = (s: string) => (s ?? '').replace(/[^0-9]/g, '');

class Rollback extends Error {}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const limArg = args.find((a) => a.startsWith('--limit'));
  const limit = limArg ? Number(limArg.split('=')[1] ?? args[args.indexOf(limArg) + 1]) : undefined;
  const CSV = args.find((a) => a.endsWith('.csv'));
  if (!CSV) throw new Error('csv path required');
  for (const k of ['CORE_DB_URL', 'MEDUSA_DB_URL']) if (!process.env[k]) throw new Error(`${k} required`);

  const core = postgres(process.env.CORE_DB_URL!, { max: 1 });
  const medusa = postgres(process.env.MEDUSA_DB_URL!, { max: 1 });

  try {
    // --- 셀메이트 CSV: 카페코드별 그룹 (단일옵션만) ---
    const text = iconv.decode(fs.readFileSync(CSV), 'euc-kr');
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const g = (d: any, k: string) => (d[k] ?? '').replace(/"/g, '').trim();
    const byCafe = new Map<string, { barcode: string }[]>();
    for (const d of parsed.data) {
      const cafe = g(d, '상품코드(카페)');
      const barcode = onlyDigits(g(d, '바코드번호(서식)'));
      if (!cafe || !barcode) continue;
      (byCafe.get(cafe) ?? byCafe.set(cafe, []).get(cafe)!).push({ barcode });
    }
    const singleCafe = [...byCafe.entries()].filter(([, v]) => v.length === 1);

    // --- Medusa: 카페코드 → pimVariantId (+ 카페코드당 variant 수) ---
    const mv: { code: string; pimv: string | null; cnt: string }[] = await medusa.unsafe(`
      SELECT left(barcode,8) AS code, min(metadata->>'pimVariantId') AS pimv, count(*) AS cnt
      FROM product_variant WHERE barcode ~ '^P' GROUP BY left(barcode,8)`);
    const medByCafe = new Map(mv.map((r) => [r.code, { pimv: r.pimv, cnt: Number(r.cnt) }]));

    // --- core: 바코드 → sku_id ---
    const codes = singleCafe.map(([, v]) => v[0].barcode);
    const skuRows: { norm: string; sku_id: string }[] = await core.unsafe(
      `SELECT regexp_replace(barcode,'[^0-9]','','g') AS norm, sku_id FROM sku_barcodes
       WHERE regexp_replace(barcode,'[^0-9]','','g') = ANY($1)`, [codes]);
    const skuByBarcode = new Map(skuRows.map((r) => [r.norm, r.sku_id]));

    // --- core: pimVariantId → pending matching_id ---
    const pimvs = [...new Set(mv.map((r) => r.pimv).filter(Boolean))] as string[];
    const matchRows: { variant_id: string; id: string }[] = await core.unsafe(
      `SELECT variant_id, id FROM product_matchings WHERE variant_id = ANY($1) AND status='pending'`, [pimvs]);
    const matchByVariant = new Map(matchRows.map((r) => [r.variant_id, r.id]));

    // --- 매칭 후보 (matchingId, skuId, variantId) ---
    const pairs: { matchingId: string; skuId: string; variantId: string }[] = [];
    for (const [cafe, rows] of singleCafe) {
      const med = medByCafe.get(cafe);
      if (!med || med.cnt !== 1 || !med.pimv) continue;
      const skuId = skuByBarcode.get(rows[0].barcode);
      if (!skuId) continue;
      const matchingId = matchByVariant.get(med.pimv);
      if (!matchingId) continue;
      pairs.push({ matchingId, skuId, variantId: med.pimv });
    }
    const targets = limit != null ? pairs.slice(0, limit) : pairs;
    console.log(`매칭 후보 ${pairs.length}개 중 이번 대상 ${targets.length}개 (${apply ? 'APPLY' : 'DRY-RUN'})`);
    targets.slice(0, 5).forEach((p) =>
      console.log(`  matching=${p.matchingId.slice(0, 8)} sku=${p.skuId.slice(0, 8)} variant=${p.variantId.slice(0, 8)}`));

    // --- 쓰기 ---
    const writeMatch = async (tx: any, p: { matchingId: string; skuId: string; variantId: string }) => {
      await tx`UPDATE product_matchings SET strategy='variant', status='matched', is_resolved=true,
               pre_stock_sellable=true, always_sellable_zero_stock=false, updated_at=now() WHERE id=${p.matchingId}`;
      await tx`INSERT INTO product_variant_sku_links (product_matching_id, sku_id, quantity)
               VALUES (${p.matchingId}, ${p.skuId}, 1) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO sales_variant_policies (variant_id, inventory_management, pre_stock_sellable, always_sellable_zero_stock)
               VALUES (${p.variantId}, true, true, false)
               ON CONFLICT (variant_id) DO UPDATE SET inventory_management=true, pre_stock_sellable=true,
               always_sellable_zero_stock=false, updated_at=now()`;
    };

    if (!apply) {
      await core.begin(async (tx: any) => {
        for (const p of targets) await writeMatch(tx, p);
        throw new Rollback();
      });
      console.log(`🔍 DRY-RUN (rolled back) — --apply 로 커밋`);
    } else {
      // 배치 커밋 — 대량 트랜잭션 timeout/lock 회피. 중단돼도 진행분 유지(멱등: 이미 matched 는 pending 조회서 제외)
      const CHUNK = 300;
      for (let i = 0; i < targets.length; i += CHUNK) {
        const batch = targets.slice(i, i + CHUNK);
        await core.begin(async (tx: any) => {
          for (const p of batch) await writeMatch(tx, p);
        });
        console.log(`  진행 ${Math.min(i + CHUNK, targets.length)}/${targets.length}`);
      }
      console.log(`✅ APPLIED — ${targets.length}건 매칭 완료`);
    }
  } catch (e) {
    if (e instanceof Rollback) console.log(`🔍 DRY-RUN (rolled back) — --apply 로 커밋`);
    else throw e;
  } finally {
    await core.end();
    await medusa.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
