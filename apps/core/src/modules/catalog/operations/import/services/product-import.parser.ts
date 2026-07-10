import * as ExcelJS from 'exceljs';
import { BadRequestError } from '@app/shared';
import { ParsedWorkbook, RawRow } from '../dto/import.types';

export const MAX_PRODUCT_ROWS = 1000;

const REQUIRED_PRODUCT_HEADERS = ['productKey', 'name'];

export class ProductImportParser {
  async parse(buffer: Buffer): Promise<ParsedWorkbook> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer);
    } catch {
      throw new BadRequestError('유효한 엑셀(.xlsx) 파일이 아닙니다.');
    }

    const productsSheet = wb.getWorksheet('Products');
    if (!productsSheet) {
      throw new BadRequestError('필수 시트 "Products" 가 없습니다.');
    }

    const products = this.readSheet(productsSheet);
    const productHeaders = Object.keys(products[0]?.cells ?? {});
    const missing = REQUIRED_PRODUCT_HEADERS.filter((h) => !productHeaders.includes(h));
    if (products.length === 0) {
      throw new BadRequestError('Products 시트에 데이터 행이 없습니다.');
    }
    if (missing.length > 0) {
      throw new BadRequestError(`Products 시트 필수 헤더 누락: ${missing.join(', ')}`);
    }
    if (products.length > MAX_PRODUCT_ROWS) {
      throw new BadRequestError(`상품 행이 상한(${MAX_PRODUCT_ROWS})을 초과했습니다. 파일을 나눠 올려주세요.`);
    }

    const optionsSheet = wb.getWorksheet('Options');
    const options = optionsSheet ? this.readSheet(optionsSheet) : [];

    return { products, options };
  }

  /** 1행=헤더, 이후=데이터. 빈 행은 건너뛰고 rowNumber 는 데이터 기준 1-based. */
  private readSheet(sheet: ExcelJS.Worksheet): RawRow[] {
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      headers[col] = String(cell.text ?? '').trim();
    });

    const rows: RawRow[] = [];
    let dataIndex = 0;
    const lastRow = sheet.rowCount;
    for (let r = 2; r <= lastRow; r++) {
      const row = sheet.getRow(r);
      const cells: Record<string, string> = {};
      let hasValue = false;
      headers.forEach((header, col) => {
        if (!header) return;
        const value = String(row.getCell(col).text ?? '').trim();
        cells[header] = value;
        if (value !== '') hasValue = true;
      });
      if (!hasValue) continue; // 완전 빈 행 skip
      dataIndex += 1;
      rows.push({ rowNumber: dataIndex, cells });
    }
    return rows;
  }
}
