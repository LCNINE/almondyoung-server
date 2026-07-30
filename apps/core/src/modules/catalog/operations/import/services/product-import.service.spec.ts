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
import { ProductImportProgressBuilder } from './product-import-progress.builder';

async function buf(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const p = wb.addWorksheet('Products');
  p.addRow(['productKey', 'name', 'marketPrice', 'basePrice']);
  rows.forEach((r) => p.addRow(r));
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

function makeService() {
  const reader = {
    loadCategoryTree: jest.fn(async () => []),
    getSession: jest.fn(),
    getProgressCounts: jest.fn(),
  } as any;
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
    // 순수 변환이라 목이 아니라 진짜를 넣는다 — 합성이 실제로 맞물리는지까지 본다.
    new ProductImportProgressBuilder(),
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

describe('ProductImportService.getProgress', () => {
  it('세션 집계를 단계별 진행률로 돌려준다 — 행 목록은 싣지 않는다', async () => {
    const { service, reader } = makeService();
    reader.getProgressCounts.mockResolvedValue({
      session: {
        id: 'sess-1',
        fileName: 'f.xlsx',
        totalRows: 5,
        invalidCount: 1,
        commitStatus: 'completed',
        publishStatus: 'running',
        commitError: null,
        publishError: null,
        cancelRequestedAt: null,
      },
      itemCounts: [
        { status: 'failed', publishStatus: 'skipped', count: 1 },
        { status: 'created', publishStatus: 'published', count: 3 },
        { status: 'created', publishStatus: 'pending', count: 1 },
      ],
    });

    const progress = await service.getProgress('sess-1');

    expect(reader.getProgressCounts).toHaveBeenCalledWith('sess-1');
    expect(progress).toMatchObject({ sessionId: 'sess-1', fileName: 'f.xlsx', canceled: false, invalidCount: 1 });
    expect(progress.stages.find((s) => s.key === 'commit')).toMatchObject({ total: 4, done: 4, failed: 0 });
    expect(progress.stages.find((s) => s.key === 'publish')).toMatchObject({ total: 4, done: 3, failed: 0 });
    expect(progress).not.toHaveProperty('items');
  });
});
