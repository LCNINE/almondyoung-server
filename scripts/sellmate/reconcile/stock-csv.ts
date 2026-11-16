/**
 * 셀메이트 재고 내보내기 CSV 읽기 (저녁 맞추기용).
 * sync-stock.ts 의 열 후보를 따르되 음수 현재재고를 허용하고, 값이 이상하면 0 으로 추정하지 않고 오류로 모은다.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { detectColumns, readRows } from '../parse';
import { excludedReason } from '../excluded';
import { unwrapFormula } from '../formula-barcodes-plan';
import { parseCutoff } from '../clear-reservations';

export type SellmateStockRow = {
  optionSerial: string;
  productSerial: string;
  name: string;
  barcode: string;
  current: number;
  unshipped: number;
};
export type StockCsv = {
  rows: SellmateStockRow[];
  /** 제외 사유별 행 수 */
  excluded: Map<string, number>;
  /** 제외된 옵션정보일련번호 */
  excludedSerials: Set<string>;
  /** 제외된 행의 바코드(unwrapFormula+trim, 빈값 제외) — 같은 바코드의 짝 품목을 올리면 제외 품목 재고를 덮는다 */
  excludedBarcodes: Set<string>;
  errors: string[];
};

const COLUMN_CANDIDATES = {
  itemCode: ['옵션정보일련번호', '옵션코드', '품목코드', '판매처옵션코드'],
  stock: ['현재재고', '가용재고', '재고', '재고수량'],
  unshipped: ['미발송주문수', '미출고주문수'],
  productSerial: ['상품일련번호'],
  productName: ['상품명', '인쇄용상품명', '상품명(서식)'],
  barcode: ['바코드번호(서식)', '바코드번호'],
} as const;
type LogicalField = keyof typeof COLUMN_CANDIDATES;

const overrides = (): Partial<Record<LogicalField, string | undefined>> => ({
  itemCode: process.env.COL_ITEM_CODE,
  stock: process.env.COL_STOCK,
  unshipped: process.env.COL_UNSHIPPED,
  productSerial: process.env.COL_PRODUCT_SERIAL,
  productName: process.env.COL_PRODUCT_NAME,
  barcode: process.env.COL_BARCODE,
});

/** 부호 있는 정수만. 천단위 쉼표·앞뒤 공백은 허용하고 빈값·소수·문자·지수 표기는 null. */
export function parseSignedInt(raw: string): number | null {
  const cleaned = (raw ?? '').toString().replace(/,/g, '').trim();
  if (!/^-?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

const cell = (row: string[], idx: number): string => (idx >= 0 ? (row[idx] ?? '').toString() : '');

export function parseReconcileStock(table: string[][], file: string): StockCsv {
  const result: StockCsv = {
    rows: [],
    excluded: new Map(),
    excludedSerials: new Set(),
    excludedBarcodes: new Set(),
    errors: [],
  };
  if (table.length < 1) throw new Error(`[${path.basename(file)}] 빈 파일입니다.`);
  const header = table[0];
  const cols = detectColumns(header, COLUMN_CANDIDATES, overrides());
  const missing = (['itemCode', 'stock', 'unshipped', 'barcode'] as const).filter((f) => cols[f] < 0);
  if (missing.length) {
    throw new Error(
      `[${path.basename(file)}] 필수 열을 못 찾았습니다: ${missing.join(', ')}\n   헤더: ${header.join(' | ')}`,
    );
  }

  const seen = new Map<string, SellmateStockRow>();
  for (let i = 1; i < table.length; i++) {
    const row = table[i];
    const optionSerial = cell(row, cols.itemCode).trim();
    if (!optionSerial) {
      // 완전히 빈 행만 건너뛴다. 값이 있는데 옵션정보일련번호만 비었으면 조용히 빼지 않는다
      if (row.some((v) => (v ?? '').toString().trim() !== '')) {
        result.errors.push(`${path.basename(file)} 행${i + 1}: 옵션정보일련번호가 비었는데 다른 값이 있습니다`);
      }
      continue;
    }
    const productSerial = cell(row, cols.productSerial).trim();
    const name = cell(row, cols.productName).trim();

    const reason = excludedReason(productSerial, name);
    if (reason) {
      result.excluded.set(reason, (result.excluded.get(reason) ?? 0) + 1);
      result.excludedSerials.add(optionSerial);
      const excludedBarcode = unwrapFormula(cell(row, cols.barcode).trim()).trim();
      if (excludedBarcode !== '') result.excludedBarcodes.add(excludedBarcode);
      continue;
    }

    const where = `${path.basename(file)} 행${i + 1} 옵션=${optionSerial}`;
    const current = parseSignedInt(cell(row, cols.stock));
    if (current === null) {
      result.errors.push(`${where}: 현재재고 "${cell(row, cols.stock)}" 를 정수로 읽을 수 없습니다`);
      continue;
    }
    const unshipped = parseSignedInt(cell(row, cols.unshipped));
    if (unshipped === null || unshipped < 0) {
      result.errors.push(`${where}: 미발송주문수 "${cell(row, cols.unshipped)}" 는 0 이상의 정수여야 합니다`);
      continue;
    }
    const barcode = unwrapFormula(cell(row, cols.barcode).trim()).trim();
    const parsed: SellmateStockRow = { optionSerial, productSerial, name, barcode, current, unshipped };

    const prev = seen.get(optionSerial);
    if (prev) {
      if (prev.current !== current || prev.unshipped !== unshipped || prev.barcode !== barcode) {
        result.errors.push(`${where}: 같은 옵션이 서로 다른 값으로 두 번 나옵니다`);
      }
      continue;
    }
    seen.set(optionSerial, parsed);
    result.rows.push(parsed);
  }
  return result;
}

/** 파일을 읽어 파싱한다. snapshotAt 은 파일명 시각(KST), sha256 은 파일 바이트. */
export async function readStockCsv(file: string): Promise<StockCsv & { sha256: string; snapshotAt: Date }> {
  const snapshotAt = parseCutoff(path.basename(file));
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const parsed = parseReconcileStock(await readRows(file), file);
  return { ...parsed, sha256, snapshotAt };
}
