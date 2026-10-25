import * as XLSX from 'xlsx';
import type { PiiMeta } from '@/lib/pii/pii-notices';
import type { SupplierSheet, SupplierSheetRow } from '@/lib/types/dto/fulfillment';

export const SUPPLIER_SHEET_NAME = '직배';

/** 권한 때문에 가렸다(`no-permission`·`reveal-required`, 이유를 모를 때도) — N3 문구 */
export const SHEET_MASKED_MESSAGE =
  '수령인 정보를 볼 권한이 없어 시트를 만들지 않았습니다. 권한을 받은 뒤 ‘넘긴 것’에서 다시 받으세요.';

/** 서버가 접속기록을 못 남겨 가렸다(`record-failed`·`unavailable`) — 잠깐 뒤 다시 받으면 된다 */
export const SHEET_MASKED_TRANSIENT_MESSAGE =
  '지금 서버가 개인정보 접속기록을 남기지 못해 수령인 정보가 가려진 채 왔고, 시트를 만들지 않았습니다. 잠시 뒤 ‘넘긴 것’에서 다시 받으세요.';

function cellText(row: SupplierSheetRow, key: string): string {
  // columns 의 key 는 서버가 정한다 — 행에 없는 key 는 빈칸, 숫자(수량)도 글자로
  const value: unknown = (row as unknown as Record<string, unknown>)[key];
  return value === null || value === undefined ? '' : String(value);
}

/**
 * 입점사에게 보낼 시트(N2). 머리글 = `columns[].header`, 칸 = `rows[i][columns[j].key]`.
 * 모든 칸을 문자열 셀로 — 전화·송장·상품코드의 앞자리 0 이 숫자로 바뀌지 않게. `salesOrderId` 는 열이 아니다.
 */
export function buildSupplierSheetWorkbook(sheet: SupplierSheet): XLSX.WorkBook {
  const header = sheet.columns.map((c) => c.header);
  const body = sheet.rows.map((row) => sheet.columns.map((c) => cellText(row, c.key)));
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  // 열 너비는 머리글 길이 기준(정보용) — 한글은 두 칸쯤 차지한다
  ws['!cols'] = header.map((h) => ({ wch: Math.max(10, h.length * 2 + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SUPPLIER_SHEET_NAME);
  return wb;
}

export function downloadSupplierSheet(sheet: SupplierSheet): void {
  XLSX.writeFile(buildSupplierSheetWorkbook(sheet), sheet.fileName);
}

/** 가린 시트는 파일로 만들지 않는다(N3) — 넘김은 이미 찍혔으니 «넘긴 것»에서 다시 받는 것이 복구 길이다 */
export function sheetDownloadDecision(
  pii: PiiMeta | null
): { ok: true } | { ok: false; message: string } {
  if (pii === null) return { ok: true };
  const transient = pii.reason === 'record-failed' || pii.reason === 'unavailable';
  return { ok: false, message: transient ? SHEET_MASKED_TRANSIENT_MESSAGE : SHEET_MASKED_MESSAGE };
}
