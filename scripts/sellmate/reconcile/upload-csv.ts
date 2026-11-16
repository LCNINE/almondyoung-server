/** 사람이 셀메이트 재고수정에 올리는 CSV 를 만든다 (바코드, 재고수량). */
import * as fs from 'fs';
import * as iconv from 'iconv-lite';

export type UploadLine = { barcode: string; current: number };

const UPLOAD_ENCODING = process.env.UPLOAD_ENCODING || 'euc-kr';

export function renderUploadCsv(lines: readonly UploadLine[]): string {
  const sorted = [...lines].sort((a, b) => (a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0));
  return ['바코드번호,재고수량', ...sorted.map((l) => `${l.barcode},${l.current}`)].join('\r\n') + '\r\n';
}

export function writeUploadCsv(filePath: string, lines: readonly UploadLine[]): void {
  fs.writeFileSync(filePath, iconv.encode(renderUploadCsv(lines), UPLOAD_ENCODING));
}
