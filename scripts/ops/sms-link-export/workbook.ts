import * as ExcelJS from 'exceljs';
import { readFile } from 'fs/promises';

/** '+821000001111' → '010-0000-1111' */
export function toDisplayPhone(e164: string): string {
  const local = `0${e164.replace(/^\+82/, '')}`;
  return local.length === 11
    ? `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`
    : `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
}

const isHeader = (value: string) => !/\d/.test(value);

/** 번호 목록: .xlsx 는 첫 시트 A열, 그 밖은 한 줄에 하나. 숫자가 없는 1행은 머리글로 건너뛰고 빈 값은 뺀다. */
export async function readPhoneList(path: string): Promise<string[]> {
  if (!path.toLowerCase().endsWith('.xlsx')) {
    const lines = (await readFile(path, 'utf8')).split(/\r?\n/).map((line) => line.trim());
    return lines.filter((line, index) => line && !(index === 0 && isHeader(line)));
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheet = workbook.worksheets[0];
  const values: string[] = [];
  sheet.eachRow((row, rowNumber) => {
    const value = String(row.getCell(1).text ?? '').trim();
    if (!value) return;
    if (rowNumber === 1 && isHeader(value)) return;
    values.push(value);
  });
  return values;
}

/** 발송 서비스 엑셀 업로드 양식: A=휴대폰번호, B=실제발송할 문구. B열까지만 읽히고, 수식이 아닌 텍스트여야 보낸다. */
export async function writeUploadWorkbook(rows: { phone: string; body: string }[], path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.columns = [
    { header: '휴대폰번호', key: 'phone', width: 16, style: { numFmt: '@' } },
    { header: '실제발송할 문구', key: 'body', width: 60, style: { alignment: { wrapText: true } } },
  ];
  for (const row of rows) sheet.addRow(row);
  await workbook.xlsx.writeFile(path);
}
