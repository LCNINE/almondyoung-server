import * as ExcelJS from 'exceljs';
import { BadRequestError } from '@app/shared';
import { SUPPLIER_SHEET_COLUMNS, type SupplierSheetKey } from './supplier-sheet.columns';
import { SupplierSheetHeaderMissingError, SupplierSheetTooManyRowsError } from './supplier-shipment.errors';

/** 한 파일의 줄 상한(빈 줄 제외). 파일 크기 상한(10MB)은 업로드 라우트가 본다. */
export const MAX_SUPPLIER_SHEET_ROWS = 2_000;

/** 입점사가 채워 돌려준 시트의 한 줄 — 판정에 쓰는 열만. 문자열은 앞뒤 공백을 지운 표시 문자열, 빈 칸은 ''. */
export type ParsedSupplierRow = {
  /** 엑셀의 실제 행 번호(머리글이 1행) — 운영자가 이 번호로 파일의 그 줄을 찾는다 */
  rowNumber: number;
  rowKey: string;
  orderNo: string;
  supplierSku: string;
  /** 정수가 아니거나 비면 null */
  qty: number | null;
  carrierRaw: string;
  /** 정규화 전(판정이 `normalizeTrackingNo` 로 비교한다) */
  trackingNo: string;
  reason: string;
};

/** 판정이 읽는 열 — 나머지(상품명·개인정보)는 읽지 않고, 빠져도 된다. */
const READ_KEYS = [
  'rowKey',
  'orderNo',
  'supplierSku',
  'qty',
  'carrier',
  'trackingNo',
  'unfulfillableReason',
] as const satisfies readonly SupplierSheetKey[];
type ReadKey = (typeof READ_KEYS)[number];

const headerOf = (key: SupplierSheetKey): string => {
  const column = SUPPLIER_SHEET_COLUMNS.find((c) => c.key === key);
  if (!column) throw new Error(`Supplier sheet column ${key} is not defined`);
  return column.header;
};

/** 셀의 표시 문자열 — 숫자로 들어온 송장번호·상품코드의 앞자리 0 을 지키려고 `value` 가 아니라 `text` 를 쓴다. */
const cellText = (cell: ExcelJS.Cell): string => String(cell.text ?? '').trim();

/**
 * 입점사가 돌려준 직배 시트(XLSX)를 줄로 읽는다(K3 PR5). 첫 시트, 첫 줄이 머리글이고 열은 위치가 아니라 머리글 글자로 찾는다.
 * **파일 수준 오류만** 던진다(줄 오류는 판정 몫). 모든 칸이 빈 줄은 건너뛴다.
 */
export async function parseSupplierSheet(buffer: Buffer): Promise<ParsedSupplierRow[]> {
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs 의 앰비언트 Buffer shim 과 @types/node 의 Buffer<T> 가 병합돼 TS2345 가 나므로 메서드 타입만 다시 선언한다
    // (bulk-upload.parser.ts 와 같은 우회).
    const xlsx = wb.xlsx as unknown as {
      load(buffer: Buffer, options?: Partial<ExcelJS.XlsxReadOptions>): Promise<ExcelJS.Workbook>;
    };
    await xlsx.load(buffer);
  } catch {
    throw new BadRequestError('유효한 엑셀(.xlsx) 파일이 아닙니다.');
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new SupplierSheetHeaderMissingError(READ_KEYS.map(headerOf));

  const keyByHeader = new Map<string, ReadKey>(READ_KEYS.map((key) => [headerOf(key), key]));
  const columnOf = new Map<ReadKey, number>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const key = keyByHeader.get(cellText(cell));
    if (!key) return; // 읽지 않는 열·입점사가 붙인 열은 무시한다
    if (columnOf.has(key)) throw new BadRequestError(`직배 시트에 "${headerOf(key)}" 열이 둘 이상입니다.`);
    columnOf.set(key, col);
  });
  const missing = READ_KEYS.filter((key) => !columnOf.has(key)).map(headerOf);
  if (missing.length > 0) throw new SupplierSheetHeaderMissingError(missing);
  const colOf = (key: ReadKey): number => {
    const col = columnOf.get(key);
    if (col === undefined) throw new Error(`Supplier sheet column ${key} was not resolved`);
    return col;
  };

  const rows: ParsedSupplierRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cellText(cell) !== '') hasValue = true;
    });
    if (!hasValue) continue;
    if (rows.length === MAX_SUPPLIER_SHEET_ROWS) {
      throw new SupplierSheetTooManyRowsError(
        `직배 시트 줄이 상한(${MAX_SUPPLIER_SHEET_ROWS})을 넘습니다. 파일을 나눠 올려주세요.`,
      );
    }
    const text = (key: ReadKey): string => cellText(row.getCell(colOf(key)));
    const qtyText = text('qty');
    rows.push({
      rowNumber: r,
      rowKey: text('rowKey'),
      orderNo: text('orderNo'),
      supplierSku: text('supplierSku'),
      qty: /^\d+$/.test(qtyText) ? Number(qtyText) : null,
      carrierRaw: text('carrier'),
      trackingNo: text('trackingNo'),
      reason: text('unfulfillableReason'),
    });
  }
  return rows;
}
