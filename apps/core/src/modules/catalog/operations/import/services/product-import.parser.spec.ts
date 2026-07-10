import * as ExcelJS from 'exceljs';
import { BadRequestError } from '@app/shared';
import { ProductImportParser } from './product-import.parser';

async function workbookBuffer(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
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

    expect(parsed.products).toEqual([{ rowNumber: 1, cells: { productKey: 'P1', name: '니트', marketPrice: '19000' } }]);
    expect(parsed.options).toEqual([{ rowNumber: 1, cells: { productKey: 'P1', optionName: '색상', optionValues: '빨강|파랑' } }]);
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
});
