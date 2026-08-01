import * as ExcelJS from 'exceljs';
import {
  CATEGORY_COLUMNS,
  CATEGORY_REFERENCE_COLUMNS,
  CONSTRAINT_COLUMNS,
  ColumnDef,
  IMAGE_COLUMNS,
  OPTION_COLUMNS,
  PRODUCT_COLUMNS,
  SHEET_NAMES,
  VARIANT_COLUMNS,
  labelsOf,
} from './form-export.sheets';
import type { PrefillRow, PrefillWorkbookData } from './form-export.types';

const META_CELL = 'B1';

function addSheet(wb: ExcelJS.Workbook, name: string, columns: ColumnDef[], rows: PrefillRow[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name);
  const header = ws.addRow(labelsOf(columns));
  columns.forEach((col, i) => {
    if (col.required) header.getCell(i + 1).font = { bold: true };
  });
  header.commit();

  for (const row of rows) {
    ws.addRow(columns.map((col) => row[col.key] ?? ''));
  }

  // 헤더가 항상 보이게 고정한다. 수십 열짜리 시트에서 작업자가 어느 칸인지 잃지 않는다.
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

/**
 * 프리필 워크북을 만든다. 순수 함수다 — DB 도 네트워크도 타지 않으므로 단위 테스트가 싸고,
 * 헤더·볼드·값 배치를 실 Postgres 없이 전부 검증할 수 있다.
 */
export async function buildFormWorkbook(data: PrefillWorkbookData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  addSheet(wb, SHEET_NAMES.products, PRODUCT_COLUMNS, data.products);
  addSheet(wb, SHEET_NAMES.options, OPTION_COLUMNS, data.options);
  addSheet(wb, SHEET_NAMES.variants, VARIANT_COLUMNS, data.variants);
  addSheet(wb, SHEET_NAMES.categories, CATEGORY_COLUMNS, data.categories);
  addSheet(wb, SHEET_NAMES.constraints, CONSTRAINT_COLUMNS, data.constraints);
  addSheet(wb, SHEET_NAMES.images, IMAGE_COLUMNS, data.images);

  // 카테고리 참조는 **상수**다. 작업자가 고쳐도 파서가 읽지 않으므로 반영되지 않는다.
  // 시트 보호는 비밀번호 없이도 실수로 지우는 것을 한 번 막아준다(의도적 우회는 못 막지만,
  // 애초에 읽지 않으므로 우회해도 무해하다).
  const reference = addSheet(
    wb,
    SHEET_NAMES.categoryReference,
    CATEGORY_REFERENCE_COLUMNS,
    data.categoryPaths.map((categoryPath) => ({ categoryPath })),
  );
  await reference.protect('', { selectLockedCells: true, selectUnlockedCells: true });

  // exportId 는 숨은 시트에 둔다. 스펙의 "숨은 열"을 시트로 구현한 것으로, 열은 정렬·삭제로
  // 쉽게 유실되지만 시트는 훨씬 덜 건드려진다. 유실되면 2단계가 신규 전용 세션으로 해석한다.
  const meta = wb.addWorksheet(SHEET_NAMES.meta);
  meta.getCell('A1').value = 'exportId';
  meta.getCell(META_CELL).value = data.exportId;
  meta.state = 'veryHidden';

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * **이미 로드된** 워크북에서 exportId 를 읽는다. 없으면 null — 신규 전용 세션이다.
 *
 * `readExportIdFromWorkbook`(아래)에서 로드 책임을 분리했다 — `parseUploadWorkbook` 이
 * 이미 같은 버퍼를 로드해둔 워크북 객체를 갖고 있어, 다시 버퍼를 로드하면 최대 10MB
 * 파일을 같은 호출 안에서 두 번 파싱하는 셈이 된다(ALB 60초에 묶인 동기 요청 경로에서
 * 비용이 실제로 든다). 메타 셀 위치 지식(SHEET_NAMES.meta, META_CELL)이 이 함수
 * 하나에만 있고, 로드 방식(버퍼 vs 이미 로드된 객체)과 분리돼 있다.
 */
export function readExportIdFromLoadedWorkbook(wb: ExcelJS.Workbook): string | null {
  const meta = wb.getWorksheet(SHEET_NAMES.meta);
  if (!meta) return null;
  const value = meta.getCell(META_CELL).text.trim();
  return value.length > 0 ? value : null;
}

/**
 * 업로드된 워크북 버퍼에서 exportId 를 되읽는다. 없으면 null — 신규 전용 세션이다.
 * 이미 로드된 워크북이 있다면(예: `parseUploadWorkbook`) 대신
 * `readExportIdFromLoadedWorkbook` 을 써서 같은 버퍼를 두 번 로드하지 않는다.
 */
export async function readExportIdFromWorkbook(buf: Buffer): Promise<string | null> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return readExportIdFromLoadedWorkbook(wb);
}
