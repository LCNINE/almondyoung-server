/**
 * 셀메이트 품목 ↔ core SKU 짝 짓기와 저장된 품목별 상태 대조 (저녁 맞추기용). 순수 함수 — DB 를 읽지 않는다.
 * 한 품목에 사유가 여럿이면 UnpairedReason 목록의 앞 사유 하나만 적는다.
 */
import type { SellmateStockRow } from './stock-csv';

export type UnpairedReason =
  | 'no_core_sku'
  | 'core_barcode_ambiguous'
  | 'empty_barcode'
  | 'barcode_shared'
  | 'code_barcode_conflict'
  | 'sku_shared';

export type CoreIndex = {
  skuIdByCode: ReadonlyMap<string, string>;
  /** 키는 저장소가 이미 unwrapFormula+trim 한 바코드 */
  skuIdsByBarcode: ReadonlyMap<string, readonly string[]>;
};

export type Pair = {
  optionSerial: string;
  productSerial: string;
  name: string;
  barcode: string;
  skuId: string;
  matchedBy: 'code' | 'barcode';
};

export type Unpaired = {
  optionSerial: string;
  productSerial: string;
  name: string;
  barcode: string;
  skuId: string | null;
  reason: UnpairedReason;
};

type Candidate = {
  row: SellmateStockRow;
  skuId: string | null;
  matchedBy: 'code' | 'barcode';
  /** 첫 패스에서 정해진 사유 (CSV 전체를 봐야 하는 사유는 아직 null) */
  reason: UnpairedReason | null;
};

function firstPass(row: SellmateStockRow, core: CoreIndex): Candidate {
  const codeSku = core.skuIdByCode.get(row.optionSerial) ?? null;
  const barcodeSkus = row.barcode === '' ? [] : (core.skuIdsByBarcode.get(row.barcode) ?? []);
  const fail = (reason: UnpairedReason, skuId: string | null): Candidate => ({
    row,
    skuId,
    matchedBy: 'code',
    reason,
  });

  if (codeSku === null && barcodeSkus.length === 0) return fail('no_core_sku', null);
  if (codeSku === null && barcodeSkus.length > 1) return fail('core_barcode_ambiguous', null);
  if (row.barcode === '') return fail('empty_barcode', codeSku);
  if (codeSku !== null) return { row, skuId: codeSku, matchedBy: 'code', reason: null };
  return { row, skuId: barcodeSkus[0], matchedBy: 'barcode', reason: null };
}

function countBy<T>(items: readonly T[], key: (t: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

/** 사유가 없는 후보는 firstPass 가 skuId 를 늘 채운다. 그 불변식을 캐스트 대신 여기서 확인한다 */
function skuOf(c: Candidate): string {
  if (c.skuId === null) throw new Error(`짝 후보에 SKU 가 없다(내부 오류): ${c.row.optionSerial}`);
  return c.skuId;
}

/**
 * excludedBarcodes = 같은 CSV 의 제외 품목(excluded.ts) 바코드. 업로드 키가 바코드라, 짝 품목이 그 바코드를 쓰면
 * 올릴 때 품절을 지켜야 하는 제외 품목 재고를 덮는다 — barcode_shared 로 막는다.
 */
export function pairItems(
  rows: readonly SellmateStockRow[],
  core: CoreIndex,
  excludedBarcodes: ReadonlySet<string>,
): { pairs: Pair[]; unpaired: Unpaired[] } {
  const candidates = rows.map((row) => firstPass(row, core));

  // 두 번째 패스: CSV 전체를 본 뒤에야 알 수 있는 사유. 앞 사유가 이미 있는 품목은 건드리지 않는다.
  const sharedBarcodes = countBy(
    candidates.filter((c) => c.reason === null),
    (c) => c.row.barcode,
  );
  for (const c of candidates) {
    if (c.reason !== null) continue;
    if ((sharedBarcodes.get(c.row.barcode) ?? 0) > 1 || excludedBarcodes.has(c.row.barcode))
      c.reason = 'barcode_shared';
  }

  for (const c of candidates) {
    if (c.reason !== null || c.matchedBy !== 'code') continue;
    const barcodeSkus = core.skuIdsByBarcode.get(c.row.barcode) ?? [];
    if (barcodeSkus.length > 0 && !barcodeSkus.includes(skuOf(c))) c.reason = 'code_barcode_conflict';
  }

  const sharedSkus = countBy(
    candidates.filter((c) => c.reason === null),
    (c) => skuOf(c),
  );
  for (const c of candidates) {
    if (c.reason === null && (sharedSkus.get(skuOf(c)) ?? 0) > 1) c.reason = 'sku_shared';
  }

  const pairs: Pair[] = [];
  const unpaired: Unpaired[] = [];
  for (const c of candidates) {
    const { optionSerial, productSerial, name, barcode } = c.row;
    if (c.reason === null) {
      pairs.push({ optionSerial, productSerial, name, barcode, skuId: skuOf(c), matchedBy: c.matchedBy });
    } else {
      unpaired.push({ optionSerial, productSerial, name, barcode, skuId: c.skuId, reason: c.reason });
    }
  }
  return { pairs, unpaired };
}

export type StateRow = {
  skuId: string;
  optionSerial: string;
  baseline: number;
  carry: number;
  frozen: boolean;
};

export type StateComparison = {
  known: Pair[];
  fresh: Pair[];
  missing: StateRow[];
  skuChanged: { pair: Pair; state: StateRow }[];
  toFreeze: StateRow[];
};

export function compareWithState(
  pairs: readonly Pair[],
  states: readonly StateRow[],
  excludedSerials: ReadonlySet<string>,
): StateComparison {
  const stateBySerial = new Map(states.map((s) => [s.optionSerial, s]));
  const pairedSerials = new Set(pairs.map((p) => p.optionSerial));
  const result: StateComparison = { known: [], fresh: [], missing: [], skuChanged: [], toFreeze: [] };

  for (const pair of pairs) {
    const state = stateBySerial.get(pair.optionSerial);
    // 얼어 있던 상태는 새로 시작한다
    if (state === undefined || state.frozen) result.fresh.push(pair);
    else if (state.skuId !== pair.skuId) result.skuChanged.push({ pair, state });
    else result.known.push(pair);
  }

  for (const state of states) {
    if (state.frozen || pairedSerials.has(state.optionSerial)) continue;
    if (excludedSerials.has(state.optionSerial)) result.toFreeze.push(state);
    else result.missing.push(state);
  }
  return result;
}
