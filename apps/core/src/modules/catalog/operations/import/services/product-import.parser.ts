import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { BadRequestError } from '@app/shared';
import { ParsedWorkbook, RawRow } from '../dto/import.types';

export const MAX_PRODUCT_ROWS = 1000;
/**
 * 상품 1000행 × 조합 상한 100 을 다 채우면 10만 행이지만, 그건 파일 크기 상한(10MB)에
 * 먼저 걸린다. 2만 행은 파싱 메모리를 보호하는 실용 상한이다.
 */
export const MAX_VARIANT_ROWS = 20_000;
/**
 * 상품 1000행 × 카테고리 5개면 5,000 행이다. 도메인 상한은 없으나(_linkCategories 는
 * 개수를 제한하지 않는다) 파싱 메모리를 보호하는 실용 상한을 둔다.
 */
export const MAX_CATEGORY_ROWS = 5_000;
/** 구매제약은 상품당 최대 1행이므로 상품 상한과 같다. */
export const MAX_CONSTRAINT_ROWS = MAX_PRODUCT_ROWS;
/**
 * 상품 1000행 × (대표 1 + 부가 5 + 본문 n) 을 넉넉히 담는 실용 상한. 파일 크기 상한
 * (10MB)에 먼저 걸리는 것이 보통이고, 이 값은 파싱 메모리를 보호한다.
 */
export const MAX_IMAGE_ROWS = 10_000;

const REQUIRED_PRODUCT_HEADERS = ['productKey', 'name'];

/**
 * 엑셀 날짜 셀을 워크북 규격 텍스트로 되돌린다.
 *
 * exceljs 는 날짜 서식 셀을 Date 로 읽고 `cell.text` 는 그 Date 의 `toString()` 이다 —
 * "Sat Aug 01 2026 09:00:00 GMT+0900 (Korean Standard Time)" 같은 **서버 로케일·TZ 의존
 * 문자열**이라 어떤 필드에도 쓸 수 없다. MD 가 날짜를 입력하면 Excel 이 자동으로 날짜
 * 서식으로 바꿔버리므로, "텍스트 서식으로 넣으세요"를 요구하는 대신 여기서 되돌린다.
 *
 * UTC 성분으로 읽는다 — exceljs 는 시트의 날짜 serial 을 UTC 기준 Date 로 만든다.
 * 로컬 성분(getMonth 등)으로 읽으면 서버 TZ 에 따라 날짜가 하루 밀린다.
 */
function formatWorkbookDateCell(value: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  const time = `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
  return time === '00:00' ? date : `${date} ${time}`;
}

@Injectable()
export class ProductImportParser {
  async parse(buffer: Buffer): Promise<ParsedWorkbook> {
    const wb = new ExcelJS.Workbook();
    try {
      // exceljs's index.d.ts ships its own ambient `interface Buffer extends ArrayBuffer {}`
      // shim (for use without @types/node). It merges with @types/node's generic
      // `Buffer<T>`, and TypeScript expands that merge to a hybrid type only inside
      // exceljs's own file, so no cast of the *value* on our side (e.g. `buffer as
      // Buffer<ArrayBuffer>`, even `as unknown as Buffer`) can satisfy `.load()`'s
      // declared param — every attempt still triggers TS2345. The runtime value is a
      // real Node Buffer and `.load()` works correctly with it; we only need to
      // re-declare the method's call-site type locally (outside exceljs's poisoned
      // merge) so `buffer: Buffer` type-checks against it.
      const xlsx = wb.xlsx as unknown as {
        load(buffer: Buffer, options?: Partial<ExcelJS.XlsxReadOptions>): Promise<ExcelJS.Workbook>;
      };
      await xlsx.load(buffer);
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

    const variantsSheet = wb.getWorksheet('Variants');
    const variants = variantsSheet ? this.readSheet(variantsSheet) : [];
    if (variants.length > MAX_VARIANT_ROWS) {
      throw new BadRequestError(`Variants 행이 상한(${MAX_VARIANT_ROWS})을 초과했습니다. 파일을 나눠 올려주세요.`);
    }

    const categoriesSheet = wb.getWorksheet('Categories');
    const categories = categoriesSheet ? this.readSheet(categoriesSheet) : [];
    if (categories.length > MAX_CATEGORY_ROWS) {
      throw new BadRequestError(`Categories 행이 상한(${MAX_CATEGORY_ROWS})을 초과했습니다. 파일을 나눠 올려주세요.`);
    }

    const constraintsSheet = wb.getWorksheet('Constraints');
    const constraints = constraintsSheet ? this.readSheet(constraintsSheet) : [];
    if (constraints.length > MAX_CONSTRAINT_ROWS) {
      throw new BadRequestError(
        `Constraints 행이 상한(${MAX_CONSTRAINT_ROWS})을 초과했습니다. 파일을 나눠 올려주세요.`,
      );
    }

    const imagesSheet = wb.getWorksheet('Images');
    const images = imagesSheet ? this.readSheet(imagesSheet) : [];
    if (images.length > MAX_IMAGE_ROWS) {
      throw new BadRequestError(`Images 행이 상한(${MAX_IMAGE_ROWS})을 초과했습니다. 파일을 나눠 올려주세요.`);
    }

    return { products, options, variants, categories, constraints, images };
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
        const cell = row.getCell(col);
        // 날짜 셀만 가로챈다. 수식 셀의 value 는 {formula, result} 객체라 instanceof 가
        // 걸리지 않으므로 기존 text 경로를 그대로 탄다.
        const value = cell.value instanceof Date ? formatWorkbookDateCell(cell.value) : String(cell.text ?? '').trim();
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
