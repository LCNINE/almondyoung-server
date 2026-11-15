import { BadRequestError } from '@app/shared';

/**
 * 입고리스트 파서 — 순수 함수. DB·Nest 를 모른다 (spec §6.3).
 * 브라우저가 병합 셀을 채워 보내므로 각 행이 자기 상자 이름을 들고 있다.
 */

export interface ListCell {
  text: string;
  value: string | number | boolean | null;
  formula?: string;
}
export interface ListRowInput {
  rowNumber: number;
  cells: ListCell[];
}
export interface ListInput {
  header: string[];
  rows: ListRowInput[];
}

export type LineIssue =
  | 'box_label_guess'
  | 'box_label_missing'
  | 'box_range_invalid'
  | 'qty_formula'
  | 'qty_invalid'
  | 'barcode_missing'
  | 'barcode_is_text'
  | 'foreign_code'
  | 'barcode_not_found'
  | 'barcode_ambiguous'
  | 'packing_unit_barcode'
  | 'option_date_coerced'
  | 'forward_hint'
  | 'contact_hint';

export interface ParsedBox {
  label: string;
  sortKey: number;
  forwardHint: string | null;
}

type RawKey =
  | 'boxLabel'
  | 'no'
  | 'productName'
  | 'quantity'
  | 'option'
  | 'barcode'
  | 'total'
  | 'remark';

export interface ParsedLine {
  rowNumber: number;
  boxLabels: string[];
  expectedQty: number | null;
  barcode: string | null;
  issues: LineIssue[];
  raw: Record<RawKey, ListCell | null>;
}
export interface ParsedList {
  boxes: ParsedBox[];
  lines: ParsedLine[];
}

export const MAX_SHIPMENT_LIST_ROWS = 2_000;
export const MAX_BOX_RANGE = 50;

const HEADER_ALIASES: Record<RawKey, string[]> = {
  boxLabel: ['박스번호', '상자번호'],
  no: ['no', '번호'],
  productName: ['제품명', '상품명'],
  quantity: ['수량'],
  option: ['옵션'],
  barcode: ['바코드'],
  total: ['총수량'],
  remark: ['비고'],
};
const REQUIRED: RawKey[] = ['boxLabel', 'quantity', 'barcode'];
const REQUIRED_NAMES: Record<string, string> = { boxLabel: '박스번호', quantity: '수량', barcode: '바코드' };

const squash = (s: string): string => s.replace(/\s+/g, '');
const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

export function expandBoxLabel(raw: string): { labels: string[]; issue: LineIssue | null } {
  const label = squash(raw).toUpperCase();
  if (!label) return { labels: [], issue: 'box_label_missing' };

  if (/^[A-Z]+\d+$/.test(label)) return { labels: [label], issue: null };

  const range = /^([A-Z]+)(\d+)[-~]([A-Z]+)?(\d+)$/.exec(label);
  if (range) {
    const [, prefix, from, endPrefix, to] = range;
    if (endPrefix !== undefined && endPrefix !== prefix) {
      return { labels: [], issue: 'box_range_invalid' };
    }
    const start = Number(from);
    const end = Number(to);
    if (end < start || end - start + 1 > MAX_BOX_RANGE) {
      return { labels: [], issue: 'box_range_invalid' };
    }
    const labels: string[] = [];
    for (let n = start; n <= end; n++) labels.push(`${prefix}${n}`);
    return { labels, issue: null };
  }

  // 깨진 표기(`L86-`): 앞쪽 접두사+숫자로 추측한다
  const guess = /^([A-Z]+)(\d+)/.exec(label);
  if (guess) return { labels: [`${guess[1]}${guess[2]}`], issue: 'box_label_guess' };
  return { labels: [], issue: 'box_label_missing' };
}

export function normalizeBarcode(
  cell: ListCell | null,
  remark?: ListCell | null,
): { barcode: string | null; issue: LineIssue | null } {
  if (!cell) return { barcode: null, issue: 'barcode_missing' };

  let text: string;
  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
    text = Number.isInteger(cell.value) ? cell.value.toFixed(0) : cell.text.trim();
  } else {
    text = cell.text.trim();
  }
  const shell = /^="(.*)"$/.exec(text);
  if (shell) text = shell[1].trim();
  if (!text) return { barcode: null, issue: 'barcode_missing' };

  const remarkText = remark?.text.trim() ?? '';
  if (/^\d+-\d+$/.test(text)) return { barcode: null, issue: 'foreign_code' };
  if (HANGUL.test(text) || (remarkText !== '' && cell.text.trim() === remarkText)) {
    return { barcode: null, issue: 'barcode_is_text' };
  }
  if (/^\d{8,}$/.test(text)) return { barcode: text, issue: null };
  // 바코드 꼴이 아닌 나머지도 품명·메모로 본다
  return { barcode: null, issue: 'barcode_is_text' };
}

function readQty(cell: ListCell | null): { qty: number | null; issue: LineIssue | null } {
  if (!cell) return { qty: null, issue: 'qty_invalid' };
  const v = cell.value;
  const asInt =
    typeof v === 'number' && Number.isInteger(v) && v > 0
      ? v
      : typeof v === 'string' && /^\d+$/.test(v.trim()) && Number(v) > 0
        ? Number(v)
        : null;
  if (asInt === null) return { qty: null, issue: 'qty_invalid' };
  return { qty: asInt, issue: cell.formula ? 'qty_formula' : null };
}

const isBlankRow = (r: ListRowInput): boolean => r.cells.every((x) => x.text.trim() === '');

export function parseShipmentList(input: ListInput): ParsedList {
  const columnOf = new Map<RawKey, number>();
  input.header.forEach((h, idx) => {
    const key = squash(h).toLowerCase();
    for (const raw of Object.keys(HEADER_ALIASES) as RawKey[]) {
      if (!columnOf.has(raw) && HEADER_ALIASES[raw].includes(key)) columnOf.set(raw, idx);
    }
  });
  const missing = REQUIRED.filter((k) => !columnOf.has(k));
  if (missing.length) {
    throw new BadRequestError(
      `입고리스트 머리글에 필수 열이 없습니다: ${missing.map((k) => REQUIRED_NAMES[k]).join(', ')}`,
    );
  }

  const rows = input.rows.filter((r) => !isBlankRow(r));
  if (rows.length > MAX_SHIPMENT_LIST_ROWS) {
    throw new BadRequestError(
      `입고리스트 줄이 상한(${MAX_SHIPMENT_LIST_ROWS})을 넘습니다. 파일을 나눠 올려주세요.`,
    );
  }

  const seenRows = new Set<number>();
  for (const r of rows) {
    if (seenRows.has(r.rowNumber)) throw new BadRequestError(`입고리스트 줄 번호가 겹칩니다: ${r.rowNumber}`);
    seenRows.add(r.rowNumber);
  }

  const boxes: ParsedBox[] = [];
  const boxByLabel = new Map<string, ParsedBox>();
  const lines: ParsedLine[] = [];

  for (const r of rows) {
    const cellAt = (k: RawKey): ListCell | null => {
      const idx = columnOf.get(k);
      return idx === undefined ? null : (r.cells[idx] ?? null);
    };
    const raw: Record<RawKey, ListCell | null> = {
      boxLabel: cellAt('boxLabel'),
      no: cellAt('no'),
      productName: cellAt('productName'),
      quantity: cellAt('quantity'),
      option: cellAt('option'),
      barcode: cellAt('barcode'),
      total: cellAt('total'),
      remark: cellAt('remark'),
    };
    const issues: LineIssue[] = [];

    const box = expandBoxLabel(raw.boxLabel?.text ?? '');
    if (box.issue) issues.push(box.issue);

    const qty = readQty(raw.quantity);
    if (qty.issue) issues.push(qty.issue);

    const bc = normalizeBarcode(raw.barcode, raw.remark);
    if (bc.issue) issues.push(bc.issue);

    if (typeof raw.option?.value === 'string' && ISO_DATE.test(raw.option.value)) {
      issues.push('option_date_coerced');
    }

    const remarkText = raw.remark?.text ?? '';
    const forward = remarkText.includes('발송');
    if (forward) issues.push('forward_hint');
    if (remarkText.includes('연락')) issues.push('contact_hint');

    for (const label of box.labels) {
      let b = boxByLabel.get(label);
      if (!b) {
        b = { label, sortKey: boxes.length, forwardHint: null };
        boxByLabel.set(label, b);
        boxes.push(b);
      }
      if (forward && b.forwardHint === null) b.forwardHint = remarkText;
    }

    lines.push({
      rowNumber: r.rowNumber,
      boxLabels: box.labels,
      expectedQty: qty.qty,
      barcode: bc.barcode,
      issues,
      raw,
    });
  }

  return { boxes, lines };
}
