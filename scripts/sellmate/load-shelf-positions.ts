/**
 * 셀메이트 재고 백업(CSV) 의 「상품위치」 → core `sku_shelf_positions` 적재 스크립트
 *
 * 입력 열: 옵션정보일련번호(= skus.code) · 상품위치 · 대표이미지주소.
 * 위치가 빈 행은 건너뛴다. 같은 SKU 코드가 두 번 나오면 마지막 값을 쓰고 보고한다.
 * 재실행 가능: sku_id 기준 upsert. 단일 트랜잭션. 이 스크립트가 건드리는 테이블은 sku_shelf_positions 하나뿐이다.
 *
 * ── 실행 ─────────────────────────────────────────────────────────────────────
 *   DRY_RUN=1 npx tsx scripts/sellmate/load-shelf-positions.ts <csv>      # 통계만, DB 안 건드림
 *   DATABASE_URL=postgres://... npx tsx scripts/sellmate/load-shelf-positions.ts <csv>
 */
import postgres, { Sql } from 'postgres';
import { readRows, detectColumns, chunk } from './parse';
// Nest 를 끌고 오는 rules 파일이 아니라 의존성 없는 파일을 상대경로로 직접 import 한다.
import { normalizePositionCode } from '../../apps/core/src/modules/inventory/sku-field-capture/position-code';

const COLUMN_CANDIDATES = {
  skuCode: ['옵션정보일련번호'],
  position: ['상품위치'],
  imageUrl: ['대표이미지주소'],
} as const;

export type ShelfPositionRow = { skuCode: string; positionCode: string; imageUrl: string | null };

export function buildShelfPositionRows(rows: string[][]): {
  rows: ShelfPositionRow[];
  skippedNoPosition: number;
  duplicateCodes: string[];
} {
  const header = rows[0] ?? [];
  const cols = detectColumns(header, COLUMN_CANDIDATES);
  if (cols.skuCode < 0 || cols.position < 0) {
    throw new Error(`필수 헤더(옵션정보일련번호, 상품위치)를 못 찾았습니다. 헤더: ${header.join(' | ')}`);
  }
  const get = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? '').toString().trim() : '');

  const bySku = new Map<string, ShelfPositionRow>();
  const dup = new Set<string>();
  let skippedNoPosition = 0;
  for (let i = 1; i < rows.length; i++) {
    const skuCode = get(rows[i], cols.skuCode);
    if (!skuCode) continue;
    const positionCode = normalizePositionCode(get(rows[i], cols.position));
    if (!positionCode) {
      skippedNoPosition++;
      continue;
    }
    if (bySku.has(skuCode)) dup.add(skuCode);
    bySku.set(skuCode, { skuCode, positionCode, imageUrl: get(rows[i], cols.imageUrl) || null });
  }
  return { rows: [...bySku.values()], skippedNoPosition, duplicateCodes: [...dup] };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('사용법: npx tsx scripts/sellmate/load-shelf-positions.ts <csv>');
    process.exit(1);
  }
  const built = buildShelfPositionRows(await readRows(file));
  console.log(`📄 위치 있는 SKU ${built.rows.length}개 / 위치 없어 건너뜀 ${built.skippedNoPosition}행`);
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
    const unmatched = await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const skuIdByCode = new Map<string, string>();
      for (const part of chunk(built.rows.map((r) => r.skuCode), 2000)) {
        const res = (await tx`SELECT id, code FROM skus WHERE code IN ${tx(part)}`) as unknown as {
          id: string;
          code: string;
        }[];
        for (const r of res) skuIdByCode.set(r.code, r.id);
      }
      const matched = built.rows.filter((r) => skuIdByCode.has(r.skuCode));
      for (const part of chunk(matched, 1000)) {
        const rows = part.map((r) => ({
          sku_id: skuIdByCode.get(r.skuCode)!,
          position_code: r.positionCode,
          image_url: r.imageUrl,
        }));
        await tx`
          INSERT INTO sku_shelf_positions ${tx(rows, 'sku_id', 'position_code', 'image_url')}
          ON CONFLICT (sku_id) DO UPDATE SET
            position_code = excluded.position_code, image_url = excluded.image_url, updated_at = now()
        `;
      }
      return built.rows.length - matched.length;
    });
    console.log(`✔ sku_shelf_positions upsert ${built.rows.length - unmatched}개`);
    console.log(`⚠️  skus 에 없는 SKU 코드 ${unmatched}개 — 미반영`);
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
