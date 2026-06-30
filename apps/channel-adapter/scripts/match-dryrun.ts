/**
 * match-dryrun.ts — SKU 매칭 가능 규모 측정 (읽기 전용, 쓰기 없음)
 *
 * 경로: 셀메이트(바코드+카페코드) → core sku_id, Medusa variant(카페코드=barcode앞8) → pimVariantId
 *       → core product_matchings(pending) → 매칭 후보 (matching_id, sku_id)
 *
 * 1차는 단일옵션 상품만 (카페코드당 셀메이트옵션 1개 & Medusa variant 1개) — 옵션 모호성 0.
 *
 * ENV: CORE_DB_URL, MEDUSA_DB_URL
 */
import * as postgresNs from 'postgres';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import * as Papa from 'papaparse';

const postgres = (postgresNs as any).default ?? postgresNs;
const onlyDigits = (s: string) => (s ?? '').replace(/[^0-9]/g, '');
const CSV = process.argv.find((a) => a.endsWith('.csv'));

async function main() {
  if (!CSV) throw new Error('csv path required');
  for (const k of ['CORE_DB_URL', 'MEDUSA_DB_URL']) if (!process.env[k]) throw new Error(`${k} required`);
  const core = postgres(process.env.CORE_DB_URL!, { max: 1 });
  const medusa = postgres(process.env.MEDUSA_DB_URL!, { max: 1 });

  try {
    // --- 셀메이트 CSV: 카페코드별 행 그룹핑 ---
    const text = iconv.decode(fs.readFileSync(CSV), 'euc-kr');
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const g = (d: any, k: string) => (d[k] ?? '').replace(/"/g, '').trim();
    const byCafe = new Map<string, { barcode: string; option: string }[]>();
    for (const d of parsed.data) {
      const cafe = g(d, '상품코드(카페)');
      const barcode = onlyDigits(g(d, '바코드번호(서식)'));
      if (!cafe || !barcode) continue;
      const arr = byCafe.get(cafe) ?? [];
      arr.push({ barcode, option: g(d, '옵션명') });
      byCafe.set(cafe, arr);
    }
    const singleCafe = [...byCafe.entries()].filter(([, v]) => v.length === 1);
    console.log(`셀메이트: 카페코드 ${byCafe.size}개, 단일옵션 ${singleCafe.length}개`);

    // --- Medusa: 카페코드(barcode 앞8) → pimVariantId. 카페코드당 variant 수도 집계 ---
    const mv: { code: string; pimv: string | null; cnt: number }[] = await medusa.unsafe(`
      SELECT left(barcode,8) AS code, min(metadata->>'pimVariantId') AS pimv, count(*) AS cnt
      FROM product_variant WHERE barcode ~ '^P' GROUP BY left(barcode,8)
    `);
    const medByCafe = new Map(mv.map((r) => [r.code, { pimv: r.pimv, cnt: Number(r.cnt) }]));

    // --- core: 바코드(정규화) → sku_id ---
    const codes = singleCafe.map(([, v]) => v[0].barcode);
    const skuRows: { norm: string; sku_id: string }[] = await core.unsafe(
      `SELECT regexp_replace(barcode,'[^0-9]','','g') AS norm, sku_id FROM sku_barcodes
       WHERE regexp_replace(barcode,'[^0-9]','','g') = ANY($1)`,
      [codes],
    );
    const skuByBarcode = new Map(skuRows.map((r) => [r.norm, r.sku_id]));

    // --- core: pimVariantId → pending matching_id ---
    const pimvs = [...new Set(mv.map((r) => r.pimv).filter(Boolean))] as string[];
    const matchRows: { variant_id: string; id: string }[] = await core.unsafe(
      `SELECT variant_id, id FROM product_matchings WHERE variant_id = ANY($1) AND status='pending'`,
      [pimvs],
    );
    const matchByVariant = new Map(matchRows.map((r) => [r.variant_id, r.id]));

    // --- 단일옵션 매핑 시도 ---
    let ok = 0, noMedusa = 0, multiVariant = 0, noSku = 0, noMatching = 0;
    const samples: string[] = [];
    for (const [cafe, rows] of singleCafe) {
      const med = medByCafe.get(cafe);
      if (!med) { noMedusa++; continue; }
      if (med.cnt !== 1) { multiVariant++; continue; }       // Medusa 쪽 옵션 여러개면 1차 제외
      const skuId = skuByBarcode.get(rows[0].barcode);
      if (!skuId) { noSku++; continue; }
      const matchingId = med.pimv ? matchByVariant.get(med.pimv) : undefined;
      if (!matchingId) { noMatching++; continue; }
      ok++;
      if (samples.length < 3) samples.push(`${cafe} sku=${skuId.slice(0,8)} matching=${matchingId.slice(0,8)}`);
    }
    console.log(`\n=== 단일옵션 매칭 가능 규모 ===`);
    console.log(`✅ 매칭가능        : ${ok}`);
    console.log(`❌ Medusa상품없음   : ${noMedusa}`);
    console.log(`❌ Medusa옵션다수   : ${multiVariant} (단일옵션인데 Medusa variant 여러개 = 옵션매핑 필요)`);
    console.log(`❌ core sku없음     : ${noSku}`);
    console.log(`❌ pending매칭없음  : ${noMatching} (이미 매칭됐거나 matching row 없음)`);
    console.log(`샘플:`, samples);
  } finally {
    await core.end();
    await medusa.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
