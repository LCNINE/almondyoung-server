import * as ExcelJS from 'exceljs';
import { BadRequestError } from '@app/shared';
import { ProductImportParser, MAX_VARIANT_ROWS } from './product-import.parser';

async function workbookBuffer(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

async function workbook(sheets: Array<{ name: string; rows: string[][] }>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    for (const row of sheet.rows) ws.addRow(row);
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
      await workbook([
        {
          name: 'Products',
          rows: [
            ['productKey', 'name'],
            ['P1', '니트'],
          ],
        },
        {
          name: 'Variants',
          rows: [
            ['productKey', 'optionCombination', 'basePrice', 'membershipPrice', 'variantCode'],
            ['P1', '색상=빨강;사이즈=L', '31000', '', 'KNIT-RD-L'],
          ],
        },
      ]),
    );
    expect(withSheet.variants).toHaveLength(1);
    expect(withSheet.variants[0].cells).toMatchObject({
      productKey: 'P1',
      optionCombination: '색상=빨강;사이즈=L',
      basePrice: '31000',
      variantCode: 'KNIT-RD-L',
    });

    const withoutSheet = await parser.parse(
      await workbook([
        {
          name: 'Products',
          rows: [
            ['productKey', 'name'],
            ['P1', '니트'],
          ],
        },
      ]),
    );
    expect(withoutSheet.variants).toEqual([]);
  });

  it('Variants 행이 상한을 넘으면 거부한다', async () => {
    const rows: string[][] = [['productKey', 'optionCombination']];
    for (let i = 0; i <= MAX_VARIANT_ROWS; i++) rows.push(['P1', `색상=v${i}`]);

    await expect(
      parser.parse(
        await workbook([
          {
            name: 'Products',
            rows: [
              ['productKey', 'name'],
              ['P1', '니트'],
            ],
          },
          { name: 'Variants', rows },
        ]),
      ),
    ).rejects.toThrow(/상한/);
  });
});
