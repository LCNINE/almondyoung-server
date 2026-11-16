import * as XLSX from 'xlsx';
import type {
  ShipmentListCell,
  ShipmentListRow,
} from '@/lib/types/dto/inbound-shipment';

export type ReadWorkbookResult = {
  sheetName: string;
  header: string[];
  rows: ShipmentListRow[];
  dataRowCount: number;
};

export class WorkbookReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookReadError';
  }
}

const READ_FAILED =
  '엑셀 파일을 읽지 못했습니다. .xlsx 파일인지 확인해 주세요.';

function toCell(raw: XLSX.CellObject | undefined): ShipmentListCell {
  if (!raw) return { text: '', value: null };
  const v: unknown = raw.v;
  const text = raw.w ?? (v === undefined || v === null ? '' : String(v));
  const value =
    v instanceof Date
      ? v.toISOString()
      : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
        ? v
        : null;
  const cell: ShipmentListCell = { text, value };
  if (raw.f) cell.formula = raw.f;
  return cell;
}

/** 병합의 왼쪽 위 칸을 범위 전체에 복사한다 — 각 행이 자기 상자 이름을 들고 가게. */
function fillMerges(ws: XLSX.WorkSheet): void {
  for (const m of ws['!merges'] ?? []) {
    const origin = ws[XLSX.utils.encode_cell(m.s)] as
      | XLSX.CellObject
      | undefined;
    if (!origin) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        ws[XLSX.utils.encode_cell({ r, c })] = { ...origin };
      }
    }
  }
}

function readSheet(
  name: string,
  ws: XLSX.WorkSheet
): ReadWorkbookResult | null {
  if (!ws['!ref']) return null;
  fillMerges(ws);
  const range = XLSX.utils.decode_range(ws['!ref']);
  const grid: ShipmentListCell[][] = [];
  let lastRow = -1;
  let lastCol = -1;
  for (let r = range.s.r; r <= range.e.r; r++) {
    const line: ShipmentListCell[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = toCell(
        ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
      );
      line.push(cell);
      if (cell.text.trim() !== '') {
        lastRow = Math.max(lastRow, r - range.s.r);
        lastCol = Math.max(lastCol, c - range.s.c);
      }
    }
    grid.push(line);
  }
  if (lastRow < 0) return null;

  const trimmed = grid
    .slice(0, lastRow + 1)
    .map((line) => line.slice(0, lastCol + 1));
  const isBlank = (line: ShipmentListCell[]) =>
    line.every((x) => x.text.trim() === '');
  const headerIdx = trimmed.findIndex((line) => !isBlank(line));
  const rows: ShipmentListRow[] = trimmed
    .slice(headerIdx + 1)
    .map((cells, i) => ({
      rowNumber: range.s.r + headerIdx + i + 2,
      cells,
    }));
  return {
    sheetName: name,
    header: trimmed[headerIdx].map((x) => x.text),
    rows,
    dataRowCount: rows.filter((r) => !isBlank(r.cells)).length,
  };
}

export function readInboundShipmentWorkbook(
  data: ArrayBuffer
): ReadWorkbookResult {
  // .xlsx 는 zip(PK) 이다. SheetJS 는 엑셀이 아닌 글자도 CSV 로 «읽어 버리므로» 먼저 거른다.
  const head = new Uint8Array(data.slice(0, 2));
  if (head[0] !== 0x50 || head[1] !== 0x4b)
    throw new WorkbookReadError(READ_FAILED);

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, { type: 'array', cellFormula: true, cellDates: true });
  } catch {
    throw new WorkbookReadError(READ_FAILED);
  }
  for (const name of wb.SheetNames) {
    const result = readSheet(name, wb.Sheets[name]);
    if (result) return result;
  }
  throw new WorkbookReadError('엑셀 파일에 내용이 있는 시트가 없습니다.');
}
