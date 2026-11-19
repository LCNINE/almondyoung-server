/**
 * 셀메이트 재고 현황 엑셀의 「공급처」·「안정재고」 → core `sku_suppliers`·`replenishment_sku_overrides.safety_stock` 적재
 *
 * 재고 현황(공급처=자체제작 + 미발송/안정재고 미만) 화면이 이 두 값을 쓴다. 상품 이관(import-products.ts)은
 * 같은 파일에서 상품·옵션·바코드만 읽고 이 두 열은 버렸다.
 *
 * 입력: 셀메이트 「재고관리 > 재고 현황 목록 > 엑셀 다운로드」(개발팀 데이터 내보내기용). 열: 옵션정보일련번호(= skus.code) · 공급처 · 안정재고.
 * - 공급처: core 에 같은 이름의 공급처가 있을 때만 연결한다(없는 이름은 만들지 않고 보고). 이미 있는 연결은 그대로 둔다.
 * - 안정재고: 0 보다 큰 값만 넣는다(셀메이트 기본값 0 = 설정 안 함). 행이 있으면 safety_stock 만 바꾼다.
 * 재실행 가능, 단일 트랜잭션.
 *
 * ── 실행 ─────────────────────────────────────────────────────────────────────
 *   DRY_RUN=1 npx tsx scripts/sellmate/load-supplier-safety.ts <xls|csv>      # 통계만, DB 안 건드림
 *   DATABASE_URL=postgres://... npx tsx scripts/sellmate/load-supplier-safety.ts <xls|csv>
 */
import postgres, { Sql } from 'postgres';
import { readRows, detectColumns, chunk } from './parse';

const COLUMN_CANDIDATES = {
  skuCode: ['옵션정보일련번호'],
  supplier: ['공급처', '공급처명'],
  safetyStock: ['안정재고', '안전재고'],
} as const;

export type SupplierSafetyRow = { skuCode: string; supplierName: string | null; safetyStock: number | null };

export function buildSupplierSafetyRows(rows: string[][]): {
  rows: SupplierSafetyRow[];
  duplicateCodes: string[];
} {
  const header = rows[0] ?? [];
  const cols = detectColumns(header, COLUMN_CANDIDATES);

  if (cols.skuCode < 0 || (cols.supplier < 0 && cols.safetyStock < 0)) {
    throw new Error(
      `필수 헤더(옵션정보일련번호 + 공급처·안정재고 중 하나)를 못 찾았습니다. 헤더: ${header.join(' | ')}`,
    );
  }

  const get = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? '').toString().trim() : '');
  const bySku = new Map<string, SupplierSafetyRow>();
  const dup = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const skuCode = get(rows[i], cols.skuCode);

    if (!skuCode) continue;

    const safety = Number.parseInt(get(rows[i], cols.safetyStock).replace(/[^\d-]/g, ''), 10);

    if (bySku.has(skuCode)) dup.add(skuCode);

    bySku.set(skuCode, {
      skuCode,
      supplierName: get(rows[i], cols.supplier) || null,
      safetyStock: Number.isNaN(safety) || safety <= 0 ? null : safety,
    });
  }

  return { rows: [...bySku.values()], duplicateCodes: [...dup] };
}

async function main() {
  const file = process.argv[2];

  if (!file) {
    console.error('사용법: npx tsx scripts/sellmate/load-supplier-safety.ts <xls|csv>');
    process.exit(1);
  }

  const built = buildSupplierSafetyRows(await readRows(file));
  const supplierCounts = new Map<string, number>();

  for (const r of built.rows) {
    if (r.supplierName) supplierCounts.set(r.supplierName, (supplierCounts.get(r.supplierName) ?? 0) + 1);
  }

  console.log(
    `📄 SKU ${built.rows.length}개 / 안정재고 있는 SKU ${built.rows.filter((r) => r.safetyStock !== null).length}개`,
  );
  console.log('   공급처별 SKU 수:', [...supplierCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15));

  if (built.duplicateCodes.length) {
    console.warn(`⚠️  같은 SKU 코드가 여러 행: ${built.duplicateCodes.length}개 (마지막 값 사용)`);
  }

  if (process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true') {
    console.log('\n✅ DRY-RUN 종료 — DB 미반영.');

    return;
  }

  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL 환경변수가 필요합니다 (core 논리 DB).');
    process.exit(1);
  }

  const sql = postgres(url, { max: 2 });

  try {
    const report = await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const skuIdByCode = new Map<string, string>();

      for (const part of chunk(
        built.rows.map((r) => r.skuCode),
        2000,
      )) {
        const res = (await tx`SELECT id, code FROM skus WHERE code IN ${tx(part)}`) as unknown as {
          id: string;
          code: string;
        }[];

        for (const r of res) skuIdByCode.set(r.code, r.id);
      }

      const suppliers = (await tx`SELECT id, name FROM suppliers`) as unknown as { id: string; name: string }[];
      const supplierIdByName = new Map(suppliers.map((s) => [s.name.trim(), s.id]));
      const matched = built.rows.filter((r) => skuIdByCode.has(r.skuCode));
      const links = matched
        .filter((r) => r.supplierName && supplierIdByName.has(r.supplierName))
        .map((r) => ({ sku_id: skuIdByCode.get(r.skuCode)!, supplier_id: supplierIdByName.get(r.supplierName!)! }));
      const unknownSuppliers = [
        ...new Set(
          matched.filter((r) => r.supplierName && !supplierIdByName.has(r.supplierName)).map((r) => r.supplierName),
        ),
      ];

      for (const part of chunk(links, 1000)) {
        await tx`
          INSERT INTO sku_suppliers ${tx(part, 'sku_id', 'supplier_id')}
          ON CONFLICT (sku_id, supplier_id) DO NOTHING
        `;
      }

      const safety = matched
        .filter((r) => r.safetyStock !== null)
        .map((r) => ({ sku_id: skuIdByCode.get(r.skuCode)!, safety_stock: r.safetyStock! }));

      for (const part of chunk(safety, 1000)) {
        await tx`
          INSERT INTO replenishment_sku_overrides ${tx(part, 'sku_id', 'safety_stock')}
          ON CONFLICT (sku_id) DO UPDATE SET safety_stock = excluded.safety_stock, updated_at = now()
        `;
      }

      return {
        unmatchedSkus: built.rows.length - matched.length,
        links: links.length,
        safety: safety.length,
        unknownSuppliers,
      };
    });

    console.log(`✔ sku_suppliers 연결 ${report.links}개 (이미 있던 연결은 그대로)`);
    console.log(`✔ 안정재고 ${report.safety}개`);
    console.log(`⚠️  skus 에 없는 SKU 코드 ${report.unmatchedSkus}개 — 미반영`);

    if (report.unknownSuppliers.length) {
      console.log(
        `⚠️  core 에 없는 공급처 이름 ${report.unknownSuppliers.length}개 — 연결 안 함:`,
        report.unknownSuppliers.slice(0, 20),
      );
    }

    console.log('\n✅ 적재 완료.');
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('\n❌ 실패:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
