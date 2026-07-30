import * as ExcelJS from 'exceljs';
import { BadRequestError } from '@app/shared';
import { ProductImportParser, MAX_VARIANT_ROWS, MAX_CATEGORY_ROWS, MAX_CONSTRAINT_ROWS } from './product-import.parser';

async function workbookBuffer(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

/** 시트명 → [헤더행, ...데이터행] 으로 워크북 버퍼를 만든다 */
async function buildWorkbook(sheets: Record<string, string[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const row of rows) ws.addRow(row);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('ProductImportParser', () => {
  const parser = new ProductImportParser();

  it('Products/Options 두 시트를 헤더 기준으로 파싱한다', async () => {
    const buf = await workbookBuffer((wb) => {
      const p = wb.addWorksheet('Products');
      p.addRow(['productKey', 'name', 'marketPrice']);
      p.addRow(['P1', '니트', '19000']);
      const o = wb.addWorksheet('Options');
      o.addRow(['productKey', 'optionName', 'optionValues']);
      o.addRow(['P1', '색상', '빨강|파랑']);
    });

    const parsed = await parser.parse(buf);

    expect(parsed.products).toEqual([
      { rowNumber: 1, cells: { productKey: 'P1', name: '니트', marketPrice: '19000' } },
    ]);
    expect(parsed.options).toEqual([
      { rowNumber: 1, cells: { productKey: 'P1', optionName: '색상', optionValues: '빨강|파랑' } },
    ]);
  });

  it('Products 시트가 없으면 BadRequestError', async () => {
    const buf = await workbookBuffer((wb) => wb.addWorksheet('Sheet1').addRow(['a']));
    await expect(parser.parse(buf)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('필수 헤더(name)가 없으면 BadRequestError', async () => {
    const buf = await workbookBuffer((wb) => {
      const p = wb.addWorksheet('Products');
      p.addRow(['productKey', 'brand']);
      p.addRow(['P1', 'ACME']);
    });
    await expect(parser.parse(buf)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('Products 데이터가 0행이면 BadRequestError', async () => {
    const buf = await workbookBuffer((wb) => wb.addWorksheet('Products').addRow(['productKey', 'name']));
    await expect(parser.parse(buf)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('상품 행이 상한을 초과하면 BadRequestError', async () => {
    const buf = await workbookBuffer((wb) => {
      const p = wb.addWorksheet('Products');
      p.addRow(['productKey', 'name']);
      for (let i = 0; i < 1001; i++) p.addRow([`P${i}`, `n${i}`]);
    });
    await expect(parser.parse(buf)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('Variants 시트를 읽고, 없으면 빈 배열이다', async () => {
    const withSheet = await parser.parse(
      await buildWorkbook({
        Products: [
          ['productKey', 'name'],
          ['P1', '니트'],
        ],
        Variants: [
          ['productKey', 'optionCombination', 'basePrice', 'membershipPrice', 'variantCode'],
          ['P1', '색상=빨강;사이즈=L', '31000', '', 'KNIT-RD-L'],
        ],
      }),
    );
    expect(withSheet.variants).toHaveLength(1);
    expect(withSheet.variants[0].cells).toMatchObject({
      productKey: 'P1',
      optionCombination: '색상=빨강;사이즈=L',
      basePrice: '31000',
      variantCode: 'KNIT-RD-L',
    });

    const withoutSheet = await parser.parse(
      await buildWorkbook({
        Products: [
          ['productKey', 'name'],
          ['P1', '니트'],
        ],
      }),
    );
    expect(withoutSheet.variants).toEqual([]);
  });

  it('Variants 행이 상한을 넘으면 거부한다', async () => {
    const rows: string[][] = [['productKey', 'optionCombination']];
    for (let i = 0; i <= MAX_VARIANT_ROWS; i++) rows.push(['P1', `색상=v${i}`]);

    await expect(
      parser.parse(
        await buildWorkbook({
          Products: [
            ['productKey', 'name'],
            ['P1', '니트'],
          ],
          Variants: rows,
        }),
      ),
    ).rejects.toThrow(/상한/);
  });
});

const PRODUCTS_MINIMAL = [
  ['productKey', 'name', 'basePrice'],
  ['P1', '니트A', '29000'],
];

describe('ProductImportParser — Categories/Constraints 시트', () => {
  const parser = new ProductImportParser();

  it('두 시트가 없으면 빈 배열이다 (기존 워크북 하위호환)', async () => {
    const parsed = await parser.parse(await buildWorkbook({ Products: PRODUCTS_MINIMAL }));
    expect(parsed.categories).toEqual([]);
    expect(parsed.constraints).toEqual([]);
  });

  it('Categories 시트를 헤더명 → 셀 맵으로 읽는다', async () => {
    const parsed = await parser.parse(
      await buildWorkbook({
        Products: PRODUCTS_MINIMAL,
        Categories: [
          ['productKey', 'categoryPath', 'isPrimary'],
          ['P1', '여성패션>니트', 'Y'],
          ['P1', '기획전>겨울신상', 'N'],
        ],
      }),
    );
    expect(parsed.categories).toEqual([
      { rowNumber: 1, cells: { productKey: 'P1', categoryPath: '여성패션>니트', isPrimary: 'Y' } },
      { rowNumber: 2, cells: { productKey: 'P1', categoryPath: '기획전>겨울신상', isPrimary: 'N' } },
    ]);
  });

  it('Constraints 시트를 읽는다', async () => {
    const parsed = await parser.parse(
      await buildWorkbook({
        Products: PRODUCTS_MINIMAL,
        Constraints: [
          ['productKey', 'requiresMembership', 'lifetimeQuantityLimit'],
          ['P1', 'Y', '2'],
        ],
      }),
    );
    expect(parsed.constraints).toEqual([
      { rowNumber: 1, cells: { productKey: 'P1', requiresMembership: 'Y', lifetimeQuantityLimit: '2' } },
    ]);
  });

  it('Categories 행 상한을 넘으면 거부한다', async () => {
    const rows: string[][] = [['productKey', 'categoryPath', 'isPrimary']];
    for (let i = 0; i <= MAX_CATEGORY_ROWS; i++) rows.push(['P1', `여성패션>니트${i}`, 'N']);
    await expect(parser.parse(await buildWorkbook({ Products: PRODUCTS_MINIMAL, Categories: rows }))).rejects.toThrow(
      /Categories/,
    );
  });

  it('Constraints 행 상한을 넘으면 거부한다', async () => {
    const rows: string[][] = [['productKey', 'requiresMembership', 'lifetimeQuantityLimit']];
    for (let i = 0; i <= MAX_CONSTRAINT_ROWS; i++) rows.push([`P${i}`, 'Y', '']);
    await expect(parser.parse(await buildWorkbook({ Products: PRODUCTS_MINIMAL, Constraints: rows }))).rejects.toThrow(
      /Constraints/,
    );
  });
});

describe('ProductImportParser — 날짜 셀 정규화', () => {
  const parser = new ProductImportParser();

  async function workbookWithDateCell(value: Date): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Products');
    ws.addRow(['productKey', 'name', 'salesStartDate']);
    ws.addRow(['P1', '니트A', value]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('자정 날짜 셀은 YYYY-MM-DD 로 읽힌다', async () => {
    const parsed = await parser.parse(await workbookWithDateCell(new Date(Date.UTC(2026, 7, 1, 0, 0))));
    expect(parsed.products[0].cells.salesStartDate).toBe('2026-08-01');
  });

  it('시각이 있는 날짜 셀은 YYYY-MM-DD HH:mm 로 읽힌다', async () => {
    const parsed = await parser.parse(await workbookWithDateCell(new Date(Date.UTC(2026, 7, 1, 14, 30))));
    expect(parsed.products[0].cells.salesStartDate).toBe('2026-08-01 14:30');
  });

  it('문자열 셀은 그대로 통과한다', async () => {
    const parsed = await parser.parse(
      await buildWorkbook({
        Products: [
          ['productKey', 'name', 'salesStartDate'],
          ['P1', '니트A', '2026-08-01'],
        ],
      }),
    );
    expect(parsed.products[0].cells.salesStartDate).toBe('2026-08-01');
  });
});
