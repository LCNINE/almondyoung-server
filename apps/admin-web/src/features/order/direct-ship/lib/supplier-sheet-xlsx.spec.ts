import * as XLSX from 'xlsx';
import type { SupplierSheet } from '@/lib/types/dto/fulfillment';
import type { PiiMeta } from '@/lib/pii/pii-notices';
import {
  SHEET_MASKED_MESSAGE,
  SHEET_MASKED_TRANSIENT_MESSAGE,
  buildSupplierSheetWorkbook,
  sheetDownloadDecision,
} from './supplier-sheet-xlsx';

const COLUMNS = [
  { key: 'rowKey', header: '행 키(지우지 마세요)' },
  { key: 'orderNo', header: '주문번호' },
  { key: 'productName', header: '상품명' },
  { key: 'supplierSku', header: '공급사 상품코드' },
  { key: 'qty', header: '수량' },
  { key: 'recipientName', header: '받는 분' },
  { key: 'recipientPhone', header: '연락처' },
  { key: 'address', header: '주소' },
  { key: 'entrancePassword', header: '공동현관 비밀번호' },
  { key: 'deliveryMemo', header: '배송 메모' },
  { key: 'carrier', header: '택배사' },
  { key: 'trackingNo', header: '송장번호' },
  { key: 'unfulfillableReason', header: '못 보냄 사유' },
];

const SHEET: SupplierSheet = {
  handoffId: 'h-1',
  supplierId: 's-1',
  fileName: '직배_가나상사_20261026.xlsx',
  columns: COLUMNS,
  rows: [
    {
      rowKey: 'foi-1',
      orderNo: '20261026-0001',
      productName: '샴푸',
      supplierSku: '00777',
      qty: 3,
      recipientName: '홍길동',
      recipientPhone: '01012345678',
      address: '서울시 어딘가',
      entrancePassword: '',
      deliveryMemo: '',
      carrier: '',
      trackingNo: '0012345',
      unfulfillableReason: '',
      salesOrderId: 'so-secret-uuid',
    },
  ],
  skippedShipments: [],
};

function readBack(wb: XLSX.WorkBook): XLSX.WorkSheet {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const back = XLSX.read(buf, { type: 'buffer' });
  expect(back.SheetNames).toEqual(['직배']);
  return back.Sheets['직배'];
}

describe('buildSupplierSheetWorkbook', () => {
  it('머리글 행은 columns 의 header 를 columns 순서로 싣는다', () => {
    const ws = readBack(buildSupplierSheetWorkbook(SHEET));
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false });
    expect(aoa[0]).toEqual(COLUMNS.map((c) => c.header));
  });

  it('모든 칸이 문자열 셀이고 앞자리 0·수량이 같은 글자로 다시 읽힌다', () => {
    const ws = readBack(buildSupplierSheetWorkbook(SHEET));
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
    const values: string[] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
        if (!cell) continue;
        expect(cell.t).toBe('s');
        values.push(String(cell.v));
      }
    }
    expect(values).toEqual(expect.arrayContaining(['01012345678', '0012345', '3', '00777']));
    expect(values).not.toContain('so-secret-uuid');
  });

  it('행 값은 columns 의 key 로 고른다 — 순서를 바꾸면 칸도 바뀐다', () => {
    const swapped: SupplierSheet = { ...SHEET, columns: [COLUMNS[4], COLUMNS[0]] };
    const ws = readBack(buildSupplierSheetWorkbook(swapped));
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false });
    expect(aoa).toEqual([
      ['수량', '행 키(지우지 마세요)'],
      ['3', 'foi-1'],
    ]);
  });

  it('줄이 없어도 머리글만 있는 시트를 만든다', () => {
    const ws = readBack(buildSupplierSheetWorkbook({ ...SHEET, rows: [] }));
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false });
    expect(aoa).toEqual([COLUMNS.map((c) => c.header)]);
  });
});

describe('sheetDownloadDecision', () => {
  it('가린 것이 없으면 내려받는다', () => {
    expect(sheetDownloadDecision(null)).toEqual({ ok: true });
  });

  it('가린 시트는 파일로 만들지 않고 다시 받기 길을 알린다', () => {
    const pii: PiiMeta = {
      maskedKinds: ['name'],
      reason: 'no-permission',
      redactedPaths: [],
      revealable: false,
    };
    expect(sheetDownloadDecision(pii)).toEqual({ ok: false, message: SHEET_MASKED_MESSAGE });
    expect(SHEET_MASKED_MESSAGE).toBe(
      '수령인 정보를 볼 권한이 없어 시트를 만들지 않았습니다. 권한을 받은 뒤 ‘넘긴 것’에서 다시 받으세요.'
    );
  });

  const masked = (reason: PiiMeta['reason']): PiiMeta => ({
    maskedKinds: ['name'],
    reason,
    redactedPaths: [],
    revealable: false,
  });

  it.each(['no-permission', 'reveal-required', null] as const)('가린 이유가 %s 면 권한 문구(N3)', (reason) => {
    expect(sheetDownloadDecision(masked(reason))).toEqual({ ok: false, message: SHEET_MASKED_MESSAGE });
  });

  it.each(['record-failed', 'unavailable'] as const)(
    '가린 이유가 %s 면 권한 탓이 아니다 — 잠시 뒤 «넘긴 것»에서 다시 받으라고 한다',
    (reason) => {
      const decision = sheetDownloadDecision(masked(reason));
      expect(decision).toEqual({ ok: false, message: SHEET_MASKED_TRANSIENT_MESSAGE });
      expect(SHEET_MASKED_TRANSIENT_MESSAGE).not.toContain('권한');
      expect(SHEET_MASKED_TRANSIENT_MESSAGE).toContain('넘긴 것');
    }
  );
});
