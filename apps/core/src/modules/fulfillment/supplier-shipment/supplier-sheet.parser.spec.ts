import * as ExcelJS from 'exceljs';
import { BadRequestError } from '@app/shared';
import { SUPPLIER_SHEET_COLUMNS } from './supplier-sheet.columns';
import { MAX_SUPPLIER_SHEET_ROWS, parseSupplierSheet } from './supplier-sheet.parser';
import {
  SupplierSheetDuplicateHeaderError,
  SupplierSheetHeaderMissingError,
  SupplierSheetTooManyRowsError,
} from './supplier-shipment.errors';

const HEADERS = SUPPLIER_SHEET_COLUMNS.map((c) => c.header);

type Cells = Partial<Record<(typeof SUPPLIER_SHEET_COLUMNS)[number]['key'], string | number>>;

const ROW_A: Cells = {
  rowKey: '11111111-1111-4111-8111-111111111111',
  orderNo: 'SO-1',
  productName: '샴푸',
  supplierSku: 'SUP-1',
  qty: 2,
  recipientName: '홍길동',
  carrier: '우체국',
  trackingNo: '1234-5678',
};
const ROW_B: Cells = {
  rowKey: '22222222-2222-4222-8222-222222222222',
  orderNo: 'SO-2',
  supplierSku: '',
  qty: 1,
  unfulfillableReason: '품절',
};

async function sheet(headers: string[], rows: Cells[], tweak?: (ws: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('직배');
  ws.addRow(headers);
  const keyOf = new Map(SUPPLIER_SHEET_COLUMNS.map((c) => [c.header.trim(), c.key]));
  for (const row of rows) ws.addRow(headers.map((h) => row[keyOf.get(h.trim()) ?? 'rowKey'] ?? null));
  tweak?.(ws);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('parseSupplierSheet (K3 PR5)', () => {
  it('정상 2줄 → 2개, 읽는 열만 문자열로(빈 칸은 빈 문자열), 엑셀 행 번호', async () => {
    const rows = await parseSupplierSheet(await sheet(HEADERS, [ROW_A, ROW_B]));
    expect(rows).toEqual([
      {
        rowNumber: 2,
        rowKey: '11111111-1111-4111-8111-111111111111',
        orderNo: 'SO-1',
        supplierSku: 'SUP-1',
        qty: 2,
        carrierRaw: '우체국',
        trackingNo: '1234-5678',
        reason: '',
      },
      {
        rowNumber: 3,
        rowKey: '22222222-2222-4222-8222-222222222222',
        orderNo: 'SO-2',
        supplierSku: '',
        qty: 1,
        carrierRaw: '',
        trackingNo: '',
        reason: '품절',
      },
    ]);
  });

  it('열 순서를 섞어도(머리글 앞뒤 공백 포함) 같다', async () => {
    const shuffled = [...HEADERS].reverse().map((h, i) => (i % 2 === 0 ? `  ${h} ` : h));
    const a = await parseSupplierSheet(await sheet(HEADERS, [ROW_A, ROW_B]));
    const b = await parseSupplierSheet(await sheet(shuffled, [ROW_A, ROW_B]));
    expect(b).toEqual(a);
  });

  it('읽지 않는 열(개인정보)이 빠져도 된다, 모르는 열은 무시한다', async () => {
    const headers = [
      '행 키(지우지 마세요)',
      '주문번호',
      '공급사 상품코드',
      '수량',
      '택배사',
      '송장번호',
      '못 보냄 사유',
      '메모',
    ];
    const rows = await parseSupplierSheet(await sheet(headers, [ROW_A]));
    expect(rows).toHaveLength(1);
    expect(rows[0].trackingNo).toBe('1234-5678');
  });

  it('송장번호 머리글 없음 → SUPPLIER_SHEET_HEADER_MISSING, 빠진 이름이 담긴다', async () => {
    const err = await parseSupplierSheet(
      await sheet(
        HEADERS.filter((h) => h !== '송장번호'),
        [ROW_A],
      ),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SupplierSheetHeaderMissingError);
    const e = err as SupplierSheetHeaderMissingError;
    expect(e.getErrorCode()).toBe('SUPPLIER_SHEET_HEADER_MISSING');
    expect(e.getHttpStatus()).toBe(400);
    expect(e.missingHeaders).toEqual(['송장번호']);
    expect(e.message).toContain('송장번호');
  });

  it(`${MAX_SUPPLIER_SHEET_ROWS + 1}줄 → SUPPLIER_SHEET_TOO_MANY_ROWS, ${MAX_SUPPLIER_SHEET_ROWS}줄은 된다`, async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...ROW_B, orderNo: `SO-${i}` }));
    expect(await parseSupplierSheet(await sheet(HEADERS, many(MAX_SUPPLIER_SHEET_ROWS)))).toHaveLength(
      MAX_SUPPLIER_SHEET_ROWS,
    );
    const err = await parseSupplierSheet(await sheet(HEADERS, many(MAX_SUPPLIER_SHEET_ROWS + 1))).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SupplierSheetTooManyRowsError);
    expect((err as SupplierSheetTooManyRowsError).getErrorCode()).toBe('SUPPLIER_SHEET_TOO_MANY_ROWS');
    expect((err as SupplierSheetTooManyRowsError).getHttpStatus()).toBe(400);
  });

  it('텍스트 서식 송장번호 012345 는 앞자리 0 이 남는다, 숫자 공급사 상품코드도 표시 문자열', async () => {
    const buffer = await sheet(HEADERS, [{ ...ROW_A, trackingNo: '012345', supplierSku: 7001 }], (ws) => {
      const col = HEADERS.indexOf('송장번호') + 1;
      ws.getCell(2, col).numFmt = '@';
    });
    const [row] = await parseSupplierSheet(buffer);
    expect(row.trackingNo).toBe('012345');
    expect(row.supplierSku).toBe('7001');
  });

  it('수량이 숫자가 아니거나 비면 null', async () => {
    const rows = await parseSupplierSheet(
      await sheet(HEADERS, [
        { ...ROW_A, qty: '2개' },
        { ...ROW_B, qty: '' },
      ]),
    );
    expect(rows.map((r) => r.qty)).toEqual([null, null]);
  });

  it('모든 칸이 빈 줄은 건너뛴다(행 번호는 엑셀 그대로)', async () => {
    const rows = await parseSupplierSheet(await sheet(HEADERS, [ROW_A, {}, ROW_B]));
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 4]);
  });

  it('같은 머리글 열이 둘 → SUPPLIER_SHEET_DUPLICATE_HEADER(400, 머리글 이름)', async () => {
    const err = await parseSupplierSheet(await sheet([...HEADERS, ' 송장번호 '], [ROW_A])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SupplierSheetDuplicateHeaderError);
    const e = err as SupplierSheetDuplicateHeaderError;
    expect(e.getErrorCode()).toBe('SUPPLIER_SHEET_DUPLICATE_HEADER');
    expect(e.getHttpStatus()).toBe(400);
    expect(e.header).toBe('송장번호');
    expect(e.message).toContain('송장번호');
  });

  it('엑셀이 아니면 400', async () => {
    await expect(parseSupplierSheet(Buffer.from('not xlsx'))).rejects.toBeInstanceOf(BadRequestError);
  });
});
