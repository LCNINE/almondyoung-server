/**
 * 셀메이트 재고상품 → core(SKU / SKU 그룹) 마이그레이션 스크립트
 *
 * 셀메이트 모델            core(inventory) 모델
 * ─────────────            ────────────────────
 * 상품(옵션 있음)   ──►  sku_group   (code=상품코드 또는 sm-{상품일련번호}, name=상품명)
 *   └ 품목           ──►  sku         (code=옵션정보일련번호, option_key=옵션명, group_id=그룹)
 * 상품(옵션 없음)   ──►  sku 1개      (그룹 없이, code=옵션정보일련번호)
 *
 * ⚠️ 옵션 묶음의 신뢰 키는 "상품일련번호" 다. 셀메이트 "상품코드" 는 빈 경우가 있고(개발팀 양식에서 확인),
 *    그때 itemCode 로 대체하면 한 상품의 옵션들이 제각각 분리돼 버린다. 그래서 상품 정체성은
 *    상품일련번호 우선, 없으면 상품코드 순으로 잡는다. 둘 다 비면 데이터 오류로 보고 중단한다.
 *
 * 입력: 셀메이트 "재고관리 > 재고 현황 목록 > 엑셀 다운로드"(개발팀 데이터 내보내기용/기본 양식).
 *       확장자는 .xls 지만 실제로는 HTML 테이블+EUC-KR 인데 parse.ts 가 알아서 읽는다.
 *
 * 재실행 가능(idempotent): code 기준 upsert 라 같은 파일을 여러 번 돌려도 중복이 안 생기고
 * 추가분/변경분만 반영된다. 재고 수량은 여기서 안 건드린다 → sync-stock.ts 담당.
 * 전체 반영은 단일 트랜잭션이라 중간 실패 시 전부 롤백된다(부분 반영 없음).
 *
 * ── 실행 ─────────────────────────────────────────────────────────────────────
 *   # 1) dry-run: 헤더 감지 + 파싱 결과만 확인 (DB 안 건드림)
 *   DRY_RUN=1 npx tsx scripts/sellmate/import-products.ts ~/Downloads/stk_stockList_*.xls
 *
 *   # 2) 폴더를 주면 안의 모든 xls/csv/xlsx 처리
 *   DRY_RUN=1 npx tsx scripts/sellmate/import-products.ts apps/core/tmp/
 *
 *   # 3) 매핑이 맞으면 실제 반영
 *   DATABASE_URL=postgres://... npx tsx scripts/sellmate/import-products.ts apps/core/tmp/
 *
 * ── 환경변수 ─────────────────────────────────────────────────────────────────
 *   DATABASE_URL        core 논리 DB 접속 문자열 (실제 반영 시 필수)
 *   DRY_RUN=1           DB 쓰기 없이 헤더 감지 + 샘플 + 통계만 출력
 *   SELLMATE_ENCODING   HTML-xls 인코딩 (기본 euc-kr)
 *   COL_PRODUCT_CODE / COL_PRODUCT_SERIAL / COL_PRODUCT_NAME / COL_ITEM_CODE / COL_OPTION_NAME / COL_BARCODE
 *                       자동감지가 틀렸을 때 해당 "헤더 이름" 직접 지정
 */
import * as path from 'path';
import * as fs from 'fs';
import postgres, { Sql } from 'postgres';
import { readRows, detectColumns } from './parse';

// 셀메이트 헤더 후보. 실제 양식 헤더(2026-06 개발팀 데이터 내보내기용) 기준으로 확정.
const COLUMN_CANDIDATES = {
  // 상품 단위(사람이 보는 코드). 빈 경우가 있어 그룹 키로 단독 신뢰하지 않는다.
  productCode: ['상품코드', '자체상품코드'],
  // 상품 단위 진짜 고유키(항상 채워짐) → 옵션 묶음의 1차 기준.
  productSerial: ['상품일련번호'],
  productName: ['상품명', '인쇄용상품명', '상품명(서식)'],
  // 품목(옵션) 단위 고유키. 옵션코드는 비어있는 경우가 많아 "옵션정보일련번호" 우선.
  itemCode: ['옵션정보일련번호', '옵션코드', '품목코드', '판매처옵션코드'],
  optionName: ['옵션명', '사입옵션명'],
  barcode: ['바코드번호(서식)', '바코드번호', '바코드번호2(서식)'],
} as const;

type LogicalField = keyof typeof COLUMN_CANDIDATES;

const OVERRIDES: Partial<Record<LogicalField, string | undefined>> = {
  productCode: process.env.COL_PRODUCT_CODE,
  productSerial: process.env.COL_PRODUCT_SERIAL,
  productName: process.env.COL_PRODUCT_NAME,
  itemCode: process.env.COL_ITEM_CODE,
  optionName: process.env.COL_OPTION_NAME,
  barcode: process.env.COL_BARCODE,
};

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

// 셀메이트는 옵션 없는 상품의 옵션명을 빈값이 아니라 "단일상품" 으로 채운다 → 옵션 없음으로 취급.
const SINGLE_OPTION_SENTINELS = new Set(['단일상품', '단일옵션', '없음']);

export type ParsedItem = {
  productCode: string;
  productSerial: string;
  productName: string;
  itemCode: string;
  optionName: string;
  barcode: string;
  /** 진단용: 원본 행 번호(1-base, 헤더 제외) */
  rowNumber: number;
  file: string;
};

export function parseFile(rows: string[][], file: string, quiet = false): ParsedItem[] {
  if (rows.length < 2) return [];
  const header = rows[0];
  const cols = detectColumns(header, COLUMN_CANDIDATES, OVERRIDES);

  if (!quiet) {
    console.log(`\n📄 ${path.basename(file)} — 감지된 열 매핑:`);
    for (const field of Object.keys(COLUMN_CANDIDATES) as LogicalField[]) {
      const idx = cols[field];
      console.log(`   ${field.padEnd(13)} → [${idx}] "${idx >= 0 ? header[idx] : '(없음)'}"`);
    }
  }

  if (cols.itemCode < 0) {
    throw new Error(
      `[${path.basename(file)}] 품목 고유키 열(옵션정보일련번호)을 못 찾았습니다.\n` +
        `   헤더: ${header.join(' | ')}\n` +
        `   → COL_ITEM_CODE="실제헤더이름" 으로 지정하세요.`,
    );
  }
  if (cols.productSerial < 0 && cols.productCode < 0) {
    throw new Error(
      `[${path.basename(file)}] 상품 식별 열(상품일련번호/상품코드)을 둘 다 못 찾았습니다.\n` +
        `   헤더: ${header.join(' | ')}\n` +
        `   → COL_PRODUCT_SERIAL 또는 COL_PRODUCT_CODE 로 지정하세요.`,
    );
  }

  const get = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? '').toString().trim() : '');

  const items: ParsedItem[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const itemCode = get(row, cols.itemCode);
    if (!itemCode) continue;
    let optionName = get(row, cols.optionName);
    if (SINGLE_OPTION_SENTINELS.has(optionName)) optionName = '';
    items.push({
      productCode: get(row, cols.productCode),
      productSerial: get(row, cols.productSerial),
      productName: get(row, cols.productName),
      itemCode,
      optionName,
      barcode: get(row, cols.barcode),
      rowNumber: i,
      file: path.basename(file),
    });
  }
  return items;
}

export type Group = { code: string; name: string };
export type Sku = {
  code: string;
  name: string;
  optionKey: string | null;
  groupCode: string | null;
  barcode: string;
};
export type Plan = { groups: Group[]; skus: Sku[]; invalid: ParsedItem[] };

/** 상품 정체성 키: 상품일련번호 우선, 없으면 상품코드. 둘 다 없으면 null(=오류 행). */
function productIdentity(it: ParsedItem): string | null {
  if (it.productSerial) return `serial:${it.productSerial}`;
  if (it.productCode) return `code:${it.productCode}`;
  return null;
}

/** 그룹/SKU 의 안정적인 code: 상품코드가 있으면 그대로, 없으면 sm-{상품일련번호}. */
function groupCodeOf(it: ParsedItem): string {
  if (it.productCode) return it.productCode;
  return `sm-${it.productSerial}`;
}

/**
 * 이미 itemCode 로 dedup 된 품목 배열을 받아 그룹/SKU 계획을 만든다.
 * 옵션 여부는 "같은 상품에 속한 서로 다른 품목 수 > 1" 또는 "옵션명이 있음" 으로 판정한다.
 * (dedup 을 먼저 했으므로 group.length 가 곧 고유 품목 수다 — 같은 파일 중복으로 옵션상품이
 *  되는 사고를 막는다.)
 */
export function buildPlan(dedupedItems: ParsedItem[]): Plan {
  const invalid: ParsedItem[] = [];
  const byProduct = new Map<string, ParsedItem[]>();
  for (const it of dedupedItems) {
    const id = productIdentity(it);
    if (!id) {
      invalid.push(it);
      continue;
    }
    const arr = byProduct.get(id) ?? [];
    arr.push(it);
    byProduct.set(id, arr);
  }

  const groups: Group[] = [];
  const skus: Sku[] = [];

  for (const [, group] of byProduct) {
    const distinctItemCodes = new Set(group.map((g) => g.itemCode)).size;
    const hasOptions = distinctItemCodes > 1 || group.some((g) => g.optionName);
    const code = groupCodeOf(group[0]);
    const productName = group[0].productName || code;

    if (hasOptions) {
      groups.push({ code, name: productName });
      for (const it of group) {
        skus.push({
          code: it.itemCode,
          name: it.optionName ? `${productName} ${it.optionName}` : productName,
          optionKey: it.optionName || null,
          groupCode: code,
          barcode: it.barcode,
        });
      }
    } else {
      const it = group[0];
      skus.push({ code: it.itemCode, name: productName, optionKey: null, groupCode: null, barcode: it.barcode });
    }
  }

  return { groups, skus, invalid };
}

/** 파일 간 같은 itemCode 중복 제거(마지막 값 우선). 옵션 판정 전에 반드시 먼저 수행한다. */
export function dedupeByItemCode(items: ParsedItem[]): ParsedItem[] {
  const byItem = new Map<string, ParsedItem>();
  for (const it of items) byItem.set(it.itemCode, it);
  return [...byItem.values()];
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('사용법: npx tsx scripts/sellmate/import-products.ts <파일 또는 폴더경로>');
    process.exit(1);
  }

  const stat = fs.statSync(target);
  const files = stat.isDirectory()
    ? fs
        .readdirSync(target)
        .filter((f) => ['.csv', '.xlsx', '.xls'].includes(path.extname(f).toLowerCase()))
        .sort((a, b) => a.localeCompare(b)) // 파일명(타임스탬프 포함) 오름차순 → 마지막=최신 결정적
        .map((f) => path.join(target, f))
    : [target];
  if (files.length === 0) {
    console.error(`처리할 xls/csv/xlsx 파일이 없습니다: ${target}`);
    process.exit(1);
  }
  console.log(`📂 처리 대상 ${files.length}개:\n   ${files.map((f) => path.basename(f)).join('\n   ')}`);

  const allItems: ParsedItem[] = [];
  for (const file of files) {
    const rows = await readRows(file);
    const items = parseFile(rows, file);
    console.log(`   → ${items.length}개 품목 파싱`);
    allItems.push(...items);
  }

  const deduped = dedupeByItemCode(allItems);
  if (deduped.length !== allItems.length) {
    console.log(`ℹ️  파일 간 중복 itemCode ${allItems.length - deduped.length}건 제거(마지막 파일 우선).`);
  }

  const { groups, skus, invalid } = buildPlan(deduped);

  if (invalid.length) {
    console.error(`\n❌ 상품일련번호·상품코드가 둘 다 빈 행 ${invalid.length}건 — 그룹을 못 잡습니다. 원본 확인 필요:`);
    for (const it of invalid.slice(0, 20)) {
      console.error(`   ${it.file} 행${it.rowNumber}: itemCode=${it.itemCode} name="${it.productName}"`);
    }
    process.exit(1);
  }

  console.log(`\n📊 집계: SKU 그룹 ${groups.length}개, SKU ${skus.length}개 (단독 SKU 포함)`);

  if (DRY_RUN) {
    console.log('\n🔎 [DRY-RUN] 샘플 8개 SKU:');
    for (const s of skus.slice(0, 8)) {
      console.log(
        `   code=${s.code} | name="${s.name}" | option=${s.optionKey ?? '-'} | group=${s.groupCode ?? '(단독)'} | barcode=${s.barcode || '(없음)'}`,
      );
    }
    console.log('\n✅ DRY-RUN 종료 — DB 미반영. 매핑이 맞으면 DRY_RUN 빼고 DATABASE_URL 주고 재실행.');
    return;
  }

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('DATABASE_URL 환경변수가 필요합니다 (core 논리 DB).');
    process.exit(1);
  }
  const sql = postgres(DATABASE_URL, { max: 4 });

  try {
    const summary = await sql.begin(async (txRaw) => {
      // postgres TransactionSql 는 Omit 기반이라 호출 시그니처가 사라진다(TS 한계) → 호출 가능한 Sql 로 취급.
      const tx = txRaw as unknown as Sql;
      const now = new Date();

      // 1) sku_groups upsert (행별, 전부 같은 트랜잭션)
      const groupIdByCode = new Map<string, string>();
      for (const g of groups) {
        const [r] = await tx<{ id: string; code: string }[]>`
          INSERT INTO sku_groups (name, code, updated_at)
          VALUES (${g.name}, ${g.code}, ${now})
          ON CONFLICT (code) DO UPDATE SET name = excluded.name, updated_at = ${now}
          RETURNING id, code
        `;
        groupIdByCode.set(r.code, r.id);
      }

      // 2) skus upsert
      const skuIdByCode = new Map<string, string>();
      for (const s of skus) {
        const groupId = s.groupCode ? (groupIdByCode.get(s.groupCode) ?? null) : null;
        const [r] = await tx<{ id: string; code: string }[]>`
          INSERT INTO skus (name, code, option_key, group_id, updated_at)
          VALUES (${s.name}, ${s.code}, ${s.optionKey}, ${groupId}, ${now})
          ON CONFLICT (code) DO UPDATE SET
            name = excluded.name, option_key = excluded.option_key,
            group_id = excluded.group_id, updated_at = ${now}
          RETURNING id, code
        `;
        skuIdByCode.set(r.code, r.id);
      }

      // 3) 대표 바코드. itemCode 를 바코드로 위조하지 않고, 빈 바코드는 건너뛴다.
      //    - 이미 같은 sku 에 달려있으면 그대로 둠(멱등)
      //    - 다른 sku 가 그 바코드를 점유 중이면 충돌로 보고 보고만 함(조용히 무시 X)
      //    - 새 바코드는 해당 sku 의 기존 primary 를 내리고 단일 primary 로 삽입(변경 바코드도 정리됨)
      const wanted = skus
        .map((s) => ({ skuId: skuIdByCode.get(s.code)!, barcode: s.barcode }))
        .filter((r) => r.skuId && r.barcode);

      let inserted = 0;
      let alreadyOk = 0;
      const conflicts: { barcode: string; wantedSku: string; ownerSku: string }[] = [];
      for (const w of wanted) {
        const [existing] = await tx<{ sku_id: string }[]>`
          SELECT sku_id FROM sku_barcodes WHERE barcode = ${w.barcode}
        `;
        if (existing) {
          if (existing.sku_id === w.skuId) {
            alreadyOk++;
          } else {
            conflicts.push({ barcode: w.barcode, wantedSku: w.skuId, ownerSku: existing.sku_id });
          }
          continue;
        }
        // sku 당 primary 하나 보장: 기존 primary 내리고 새 바코드를 primary 로.
        await tx`UPDATE sku_barcodes SET is_primary = false, updated_at = ${now} WHERE sku_id = ${w.skuId} AND is_primary = true`;
        await tx`
          INSERT INTO sku_barcodes (sku_id, barcode, is_primary, updated_at)
          VALUES (${w.skuId}, ${w.barcode}, true, ${now})
        `;
        inserted++;
      }

      return { groups: groupIdByCode.size, skus: skuIdByCode.size, inserted, alreadyOk, conflicts };
    });

    console.log(`✔ sku_groups: ${summary.groups}개 upsert`);
    console.log(`✔ skus: ${summary.skus}개 upsert`);
    console.log(`✔ sku_barcodes: 신규 ${summary.inserted}개 / 기존 유지 ${summary.alreadyOk}개`);
    if (summary.conflicts.length) {
      console.warn(`\n⚠️  바코드 충돌 ${summary.conflicts.length}건(다른 SKU 가 이미 점유 — 미반영):`);
      for (const c of summary.conflicts.slice(0, 20)) {
        console.warn(`   barcode=${c.barcode} 원하던 sku=${c.wantedSku} 점유 sku=${c.ownerSku}`);
      }
      console.warn('   → 의도된 이전이면 수동 정리 후 재실행하세요.');
    }
    console.log('\n✅ 임포트 완료.');
  } finally {
    await sql.end();
  }
}

// 테스트에서 import 할 때는 main 을 자동 실행하지 않는다.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('\n❌ 실패:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
