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
  p.addRow(['productKey', 'name', 'marketPrice', 'basePrice']);
  rows.forEach((r) => p.addRow(r));
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

function makeService() {
  const reader = { loadCategoryTree: jest.fn(async () => []), getSession: jest.fn() } as any;
  const manager = {
    acceptCommit: jest.fn(async () => ({
      sessionId: 's1',
      status: 'queued' as const,
      totalRows: 1,
      queuedCount: 1,
      invalidCount: 0,
    })),
  } as any;
  const variantCodeChecker = { check: jest.fn(async () => undefined) } as any;
  const service = new ProductImportService(
    new ProductImportParser(),
    new ProductImportNormalizer(),
    new ProductImportValidator(),
    reader,
    manager,
    variantCodeChecker,
  );
  return { service, reader, manager, variantCodeChecker };
}

describe('ProductImportService.validate', () => {
  it('유효/무효 행을 집계한 프리뷰를 DB 쓰기 없이 반환한다', async () => {
    const { service, manager } = makeService();
    const preview = await service.validate(
      await buf([
        ['P1', '니트', '19000', '29000'],
        ['P2', '', '-1', '29000'],
      ]),
    );

    expect(preview.totalRows).toBe(2);
    expect(preview.validCount).toBe(1);
    expect(preview.invalidCount).toBe(1);
    expect(manager.acceptCommit).not.toHaveBeenCalled();
    const invalid = preview.rows.find((r) => r.productKey === 'P2');
    expect(invalid!.status).toBe('invalid');
    expect(invalid!.errors.length).toBeGreaterThan(0);
  });
});

describe('ProductImportService.commit', () => {
  it('정규화·검증 후 manager.acceptCommit 에 레코드를 넘긴다', async () => {
    const { service, manager } = makeService();
    const result = await service.commit(await buf([['P1', '니트', '19000', '29000']]), 'f.xlsx', 'u1');
    expect(manager.acceptCommit).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'f.xlsx', userId: 'u1' }));
    expect(result.sessionId).toBe('s1');
  });
});

describe('ProductImportService.getSession', () => {
  it('세션 상세가 잡 상태와 게시 카운트를 담는다', async () => {
    const { service, reader } = makeService();
    reader.getSession.mockResolvedValue({
      session: {
        id: 'sess-1',
        fileName: 'f.xlsx',
        totalRows: 3,
        createdCount: 2,
        failedCount: 1,
        status: 'completed',
        createdAt: new Date('2026-07-28T00:00:00.000Z'),
        commitStatus: 'completed',
        publishStatus: 'running',
        publishedCount: 1,
        publishFailedCount: 0,
        commitError: null,
        publishError: null,
      },
      items: [
        {
          rowNumber: 1,
          productKey: 'P1',
          status: 'created',
          masterId: 'm1',
          errorMessage: null,
          publishStatus: 'published',
          publishError: null,
        },
      ],
    });

    const result = await service.getSession('sess-1');

    expect(result).toMatchObject({
      commitStatus: 'completed',
      publishStatus: 'running',
      publishedCount: 1,
      publishFailedCount: 0,
    });
    expect(result.items[0]).toMatchObject({ publishStatus: 'published' });
  });
});
