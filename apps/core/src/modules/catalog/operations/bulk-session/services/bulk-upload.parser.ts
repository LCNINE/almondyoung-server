import * as ExcelJS from 'exceljs';
import { BadRequestError } from '@app/shared';
import {
  CATEGORY_COLUMNS,
  CONSTRAINT_COLUMNS,
  ColumnDef,
  IMAGE_COLUMNS,
  OPTION_COLUMNS,
  PRODUCT_COLUMNS,
  SHEET_NAMES,
  VARIANT_COLUMNS,
} from './form-export.sheets';
import { readExportIdFromLoadedWorkbook } from './form-export.workbook';
import type { PresentColumns, PrefillRow } from './bulk-session.types';

/**
 * 업로드 파일 크기 상한. 수천 행 × 7시트면 10MB 를 넘을 수 있다(스펙 §6). 실측 후
 * 조정한다 — 지금은 v3 값에서 출발한다.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** v3 와 같은 값에서 출발한다. 파일 크기 상한(10MB)에 먼저 걸리는 것이 보통이다. */
export const MAX_UPLOAD_PRODUCT_ROWS = 1000;
export const MAX_UPLOAD_OPTION_ROWS = 20_000;
export const MAX_UPLOAD_VARIANT_ROWS = 20_000;
export const MAX_UPLOAD_CATEGORY_ROWS = 5_000;
export const MAX_UPLOAD_CONSTRAINT_ROWS = MAX_UPLOAD_PRODUCT_ROWS;
export const MAX_UPLOAD_IMAGE_ROWS = 10_000;

export interface RawSheetRow {
  /** 엑셀의 실제 행 번호(헤더가 1행이므로 첫 데이터 행은 2). 작업자가 이 번호로 파일에서 그 줄을 바로 찾는다. */
  rowNumber: number;
  /** ColumnDef.key → trim 된 셀 문자열. 한국어 라벨은 여기서 이미 사라진다. */
  cells: PrefillRow;
}

export interface ParsedUpload {
  exportId: string | null;
  sheets: {
    products: RawSheetRow[];
    options: RawSheetRow[];
    variants: RawSheetRow[];
    categories: RawSheetRow[];
    constraints: RawSheetRow[];
    images: RawSheetRow[];
  };
  present: PresentColumns;
}

/**
 * 엑셀 날짜 셀을 워크북 규격 텍스트로 되돌린다. exceljs 는 날짜 서식 셀을 Date 로 읽고
 * `cell.text` 는 서버 로케일·TZ 의존 문자열이라 어디에도 못 쓴다. UTC 성분으로 읽는다 —
 * exceljs 가 날짜 serial 을 UTC 기준 Date 로 만들기 때문이다.
 * (product-import.parser.ts:38-43 과 같은 함수·같은 이유. 옛 임포트는 6단계에서 지워지므로
 *  공통화하지 않는다 — 사용자가 하나로 줄어들 추상화를 미리 만드는 셈이 된다.)
 */
function formatWorkbookDateCell(value: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  const time = `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
  return time === '00:00' ? date : `${date} ${time}`;
}

function readSheet(
  sheet: ExcelJS.Worksheet | undefined,
  columns: ColumnDef[],
  sheetName: string,
): { rows: RawSheetRow[]; present: Set<string> } {
  if (!sheet) return { rows: [], present: new Set() };

  const keyByLabel = new Map(columns.map((c) => [c.label, c.key]));
  const keyByColumn: string[] = [];
  const present = new Set<string>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const label = String(cell.text ?? '').trim();
    const key = keyByLabel.get(label);
    if (!key) return; // 모르는 열은 무시한다 — 작업자가 메모 열을 붙여도 안전하다
    if (keyByColumn[col]) {
      // 이미 설정됐다는 것은 같은 key 가 두 열에 매핑되었다는 뜻이다 — 불가능하지만 방어적 처리
      throw new BadRequestError(`"${sheetName}" 시트에 "${label}" 열이 중복되었습니다. 한 열만 남겨주세요.`);
    }
    if (present.has(key)) {
      // 같은 label 이 이미 present 에 들어갔다 — 즉 앞 열이 이미 이 key 를 등록했다
      throw new BadRequestError(`"${sheetName}" 시트에 "${label}" 열이 중복되었습니다. 한 열만 남겨주세요.`);
    }
    keyByColumn[col] = key;
    present.add(key);
  });

  const rows: RawSheetRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: PrefillRow = {};
    let hasValue = false;
    keyByColumn.forEach((key, col) => {
      if (!key) return;
      const cell = row.getCell(col);
      // 날짜 셀만 가로챈다. 수식 셀의 value 는 {formula, result} 객체라 instanceof 가 걸리지 않는다.
      const value = cell.value instanceof Date ? formatWorkbookDateCell(cell.value) : String(cell.text ?? '').trim();
      cells[key] = value;
      if (value !== '') hasValue = true;
    });
    if (!hasValue) continue; // 완전 빈 행은 건너뛴다
    rows.push({ rowNumber: r, cells });
  }
  return { rows, present };
}

function capped(rows: RawSheetRow[], max: number, sheetName: string): RawSheetRow[] {
  if (rows.length > max) {
    throw new BadRequestError(`"${sheetName}" 시트 행이 상한(${max})을 초과했습니다. 파일을 나눠 올려주세요.`);
  }
  return rows;
}

/**
 * 업로드 워크북을 시트별 행으로 되읽는다. **파일 수준 오류만** 던진다(행 오류는 검증기 몫).
 *
 * "카테고리 참조" 시트는 아예 읽지 않는다 — 상수이고, 작업자가 고쳐도 반영되지 않는 것이
 * 설계다(스펙 §3.4).
 */
export async function parseUploadWorkbook(buffer: Buffer): Promise<ParsedUpload> {
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs 의 앰비언트 Buffer shim 과 @types/node 의 Buffer<T> 가 병합돼 호출부에서
    // TS2345 가 나므로 메서드 타입만 지역에서 다시 선언한다(product-import.parser.ts:50-61
    // 에 같은 우회와 그 근거가 적혀 있다).
    const xlsx = wb.xlsx as unknown as {
      load(buffer: Buffer, options?: Partial<ExcelJS.XlsxReadOptions>): Promise<ExcelJS.Workbook>;
    };
    await xlsx.load(buffer);
  } catch {
    throw new BadRequestError('유효한 엑셀(.xlsx) 파일이 아닙니다.');
  }

  const productsSheet = wb.getWorksheet(SHEET_NAMES.products);
  if (!productsSheet) throw new BadRequestError(`필수 시트 "${SHEET_NAMES.products}" 가 없습니다.`);

  const products = readSheet(productsSheet, PRODUCT_COLUMNS, SHEET_NAMES.products);
  const missing = PRODUCT_COLUMNS.filter((c) => c.required && !products.present.has(c.key)).map((c) => c.label);
  if (missing.length > 0) throw new BadRequestError(`"상품" 시트 필수 열 누락: ${missing.join(', ')}`);
  if (products.rows.length === 0) throw new BadRequestError('"상품" 시트에 데이터 행이 없습니다.');
  capped(products.rows, MAX_UPLOAD_PRODUCT_ROWS, SHEET_NAMES.products);

  const options = readSheet(wb.getWorksheet(SHEET_NAMES.options), OPTION_COLUMNS, SHEET_NAMES.options);
  const variants = readSheet(wb.getWorksheet(SHEET_NAMES.variants), VARIANT_COLUMNS, SHEET_NAMES.variants);
  const categories = readSheet(wb.getWorksheet(SHEET_NAMES.categories), CATEGORY_COLUMNS, SHEET_NAMES.categories);
  const constraints = readSheet(wb.getWorksheet(SHEET_NAMES.constraints), CONSTRAINT_COLUMNS, SHEET_NAMES.constraints);
  const images = readSheet(wb.getWorksheet(SHEET_NAMES.images), IMAGE_COLUMNS, SHEET_NAMES.images);

  capped(options.rows, MAX_UPLOAD_OPTION_ROWS, SHEET_NAMES.options);
  capped(variants.rows, MAX_UPLOAD_VARIANT_ROWS, SHEET_NAMES.variants);
  capped(categories.rows, MAX_UPLOAD_CATEGORY_ROWS, SHEET_NAMES.categories);
  capped(constraints.rows, MAX_UPLOAD_CONSTRAINT_ROWS, SHEET_NAMES.constraints);
  capped(images.rows, MAX_UPLOAD_IMAGE_ROWS, SHEET_NAMES.images);

  return {
    // 이미 로드된 wb 에서 읽는다 — 같은 버퍼를 다시 로드하지 않는다(최대 10MB 파일을
    // 이 함수 안에서 두 번 파싱하던 것을 한 번으로 줄인다. form-export.workbook.ts 의
    // readExportIdFromLoadedWorkbook 주석 참조).
    exportId: readExportIdFromLoadedWorkbook(wb),
    sheets: {
      products: products.rows,
      options: options.rows,
      variants: variants.rows,
      categories: categories.rows,
      constraints: constraints.rows,
      images: images.rows,
    },
    present: {
      products: products.present,
      options: options.present,
      variants: variants.present,
      categories: categories.present,
      constraints: constraints.present,
    },
  };
}
