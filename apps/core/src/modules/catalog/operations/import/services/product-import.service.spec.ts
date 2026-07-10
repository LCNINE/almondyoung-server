jest.mock(
  '@packages/event-contracts',
  () => ({ PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' } }),
  { virtual: true },
);

import * as ExcelJS from 'exceljs';
import { ProductImportService } from './product-import.service';
import { ProductImportParser } from './product-import.parser';
import { ProductImportNormalizer } from './product-import.normalizer';
import { ProductImportValidator } from './product-import.validator';

async function buf(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const p = wb.addWorksheet('Products');
  p.addRow(['productKey', 'name', 'marketPrice']);
  rows.forEach((r) => p.addRow(r));
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

function makeService() {
  const reader = { loadCategoryTree: jest.fn(async () => []) } as any;
  const manager = {
    commit: jest.fn(async () => ({ sessionId: 's1', createdCount: 1, failedCount: 0, items: [] })),
  } as any;
  const service = new ProductImportService(
    new ProductImportParser(),
    new ProductImportNormalizer(),
    new ProductImportValidator(),
    reader,
    manager,
  );
  return { service, manager };
}

describe('ProductImportService.validate', () => {
  it('유효/무효 행을 집계한 프리뷰를 DB 쓰기 없이 반환한다', async () => {
    const { service, manager } = makeService();
    const preview = await service.validate(
      await buf([
        ['P1', '니트', '19000'],
        ['P2', '', '-1'],
      ]),
    );

    expect(preview.totalRows).toBe(2);
    expect(preview.validCount).toBe(1);
    expect(preview.invalidCount).toBe(1);
    expect(manager.commit).not.toHaveBeenCalled();
    const invalid = preview.rows.find((r) => r.productKey === 'P2');
    expect(invalid!.status).toBe('invalid');
    expect(invalid!.errors.length).toBeGreaterThan(0);
  });
});

describe('ProductImportService.commit', () => {
  it('정규화·검증 후 manager.commit 에 레코드를 넘긴다', async () => {
    const { service, manager } = makeService();
    const result = await service.commit(await buf([['P1', '니트', '19000']]), 'f.xlsx', 'u1');
    expect(manager.commit).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'f.xlsx', userId: 'u1' }));
    expect(result.sessionId).toBe('s1');
  });
});
