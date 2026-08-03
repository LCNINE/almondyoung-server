import * as ExcelJS from 'exceljs';
import { buildFormWorkbook, readExportIdFromWorkbook } from './form-export.workbook';
import { SHEET_NAMES, PRODUCT_COLUMNS, labelsOf } from './form-export.sheets';
import type { PrefillWorkbookData } from './form-export.types';

const data: PrefillWorkbookData = {
  exportId: '0193aaaa-bbbb-7ccc-8ddd-eeeeffff0000',
  products: [{ rowKey: 'P-000001', name: '겨울 니트', basePrice: '29000', brand: 'ACME' }],
  options: [
    { rowKey: 'P-000001', optionKey: 'OG-1', optionName: '색상', optionValueKey: 'OV-1', optionValueName: '빨강' },
  ],
  variants: [{ rowKey: 'P-000001', combination: 'OV-1', combinationLabel: '색상=빨강', basePrice: '29000' }],
  categories: [{ rowKey: 'P-000001', categoryPath: '여성패션>니트', isPrimary: 'Y' }],
  constraints: [{ rowKey: 'P-000001', requiresMembership: 'N', lifetimeQuantityLimit: '2' }],
  images: [{ imageKey: 'IMG-1', sourceValue: '0193bbbb-cccc-7ddd-8eee-ffff00001111' }],
  categoryPaths: ['여성패션', '여성패션>니트', '기획전>겨울신상'],
};

async function load(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

describe('buildFormWorkbook', () => {
  it('시트 8개를 순서대로 만든다 (보이는 7개 + 숨은 메타 1개)', async () => {
    const wb = await load(await buildFormWorkbook(data));
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      SHEET_NAMES.products,
      SHEET_NAMES.options,
      SHEET_NAMES.variants,
      SHEET_NAMES.categories,
      SHEET_NAMES.constraints,
      SHEET_NAMES.images,
      SHEET_NAMES.categoryReference,
      SHEET_NAMES.meta,
    ]);
  });

  it('상품 시트 헤더가 한국어 라벨이다', async () => {
    const wb = await load(await buildFormWorkbook(data));
    const header = wb.getWorksheet(SHEET_NAMES.products)!.getRow(1);
    const actual = labelsOf(PRODUCT_COLUMNS).map((_, i) => header.getCell(i + 1).text);
    expect(actual).toEqual(labelsOf(PRODUCT_COLUMNS));
  });

  it('필수 열 헤더만 볼드다', async () => {
    const wb = await load(await buildFormWorkbook(data));
    const header = wb.getWorksheet(SHEET_NAMES.products)!.getRow(1);
    PRODUCT_COLUMNS.forEach((col, i) => {
      expect(header.getCell(i + 1).font?.bold ?? false).toBe(col.required);
    });
  });

  it('프리필 값이 열 정의 순서대로 들어간다', async () => {
    const wb = await load(await buildFormWorkbook(data));
    const row = wb.getWorksheet(SHEET_NAMES.products)!.getRow(2);
    const keyIndex = (key: string): number => PRODUCT_COLUMNS.findIndex((c) => c.key === key) + 1;
    expect(row.getCell(keyIndex('rowKey')).text).toBe('P-000001');
    expect(row.getCell(keyIndex('name')).text).toBe('겨울 니트');
    expect(row.getCell(keyIndex('brand')).text).toBe('ACME');
  });

  it('값이 없는 열은 빈 문자열이다', async () => {
    const wb = await load(await buildFormWorkbook(data));
    const row = wb.getWorksheet(SHEET_NAMES.products)!.getRow(2);
    const idx = PRODUCT_COLUMNS.findIndex((c) => c.key === 'seoTitle') + 1;
    expect(row.getCell(idx).text).toBe('');
  });

  it('카테고리 참조 시트에 전체 경로가 들어가고 보호된다', async () => {
    const wb = await load(await buildFormWorkbook(data));
    const ws = wb.getWorksheet(SHEET_NAMES.categoryReference)!;
    expect(ws.getRow(2).getCell(1).text).toBe('여성패션');
    expect(ws.getRow(4).getCell(1).text).toBe('기획전>겨울신상');
  });

  it('메타 시트는 숨겨져 있다', async () => {
    const wb = await load(await buildFormWorkbook(data));
    expect(wb.getWorksheet(SHEET_NAMES.meta)!.state).toBe('veryHidden');
  });

  it('exportId 를 다시 읽어낼 수 있다', async () => {
    const buf = await buildFormWorkbook(data);
    await expect(readExportIdFromWorkbook(buf)).resolves.toBe(data.exportId);
  });

  it('메타 시트가 없으면 null 을 돌려준다 — 신규 전용 세션으로 해석된다', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet(SHEET_NAMES.products).addRow(labelsOf(PRODUCT_COLUMNS));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(readExportIdFromWorkbook(buf)).resolves.toBeNull();
  });
});
