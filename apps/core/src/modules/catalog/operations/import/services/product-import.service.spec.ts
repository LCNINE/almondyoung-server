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
import { ProductRecord } from '../dto/import.types';

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

/**
 * 파서·정규화기·검증기까지 목으로 감싼 하네스. `setRecords` 로 파이프라인 최종 결과를
 * 직접 주입해, xlsx 워크북을 조립하지 않고도 ProductRecord 필드(다중 카테고리·판매기간 등)를
 * 자유롭게 세팅해 프리뷰 매핑만 검증한다.
 */
function harness() {
  const parser = {
    parse: jest.fn(async () => ({ products: [], options: [], variants: [], categories: [], constraints: [] })),
  } as any;
  const normalizer = { normalize: jest.fn(() => []) } as any;
  const validator = { validate: jest.fn((records: ProductRecord[]) => records) } as any;
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
    parser,
    normalizer,
    validator,
    reader,
    manager,
    variantCodeChecker,
    new ProductImportProgressBuilder(),
  );
  function setRecords(records: ProductRecord[]): void {
    validator.validate.mockReturnValue(records);
  }
  return { service, parser, normalizer, validator, reader, manager, variantCodeChecker, setRecords };
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

  it('프리뷰가 카테고리 개수와 KST 판매기간을 담는다', async () => {
    const { service, setRecords } = harness();
    setRecords([
      {
        rowNumber: 1,
        productKey: 'P1',
        raw: { name: '니트A' },
        version: { name: '니트A' },
        basePrice: 29000,
        categoryIds: ['c-knit', 'c-event'],
        categoryNames: ['여성패션', '니트'],
        primaryCategoryId: 'c-knit',
        options: [],
        variantOverrides: [],
        errors: [],
        salesStartDate: '2026-07-31T15:00:00.000Z',
        salesEndDate: '2026-08-31T14:59:59.999Z',
      },
    ]);

    const preview = await service.validate(Buffer.from(''));

    expect(preview.rows[0].resolved.categoryCount).toBe(2);
    expect(preview.rows[0].resolved.categoryNames).toEqual(['여성패션', '니트']);
    expect(preview.rows[0].resolved.salesPeriod).toBe('2026-08-01 00:00 ~ 2026-08-31 23:59');
  });

  it('판매기간이 없으면 null 이다', async () => {
    const { service, setRecords } = harness();
    setRecords([
      {
        rowNumber: 1,
        productKey: 'P1',
        raw: { name: '니트A' },
        version: { name: '니트A' },
        basePrice: 29000,
        categoryIds: [],
        categoryNames: [],
        options: [],
        variantOverrides: [],
        errors: [],
      },
    ]);

    const preview = await service.validate(Buffer.from(''));
    expect(preview.rows[0].resolved.salesPeriod).toBeNull();
    expect(preview.rows[0].resolved.categoryCount).toBe(0);
  });

  it('시작일만 있으면 종료 쪽을 "종료일 없음"으로 명시한다 — 빈 문자열이면 제한없음으로 오독된다', async () => {
    const { service, setRecords } = harness();
    setRecords([
      {
        rowNumber: 1,
        productKey: 'P1',
        raw: { name: '니트A' },
        version: { name: '니트A' },
        basePrice: 29000,
        categoryIds: [],
        categoryNames: [],
        options: [],
        variantOverrides: [],
        errors: [],
        salesStartDate: '2026-07-31T15:00:00.000Z',
      },
    ]);

    const preview = await service.validate(Buffer.from(''));
    expect(preview.rows[0].resolved.salesPeriod).toBe('2026-08-01 00:00 ~ 종료일 없음');
  });

  it('종료일만 있으면 시작 쪽을 "시작일 없음"으로 명시한다', async () => {
    const { service, setRecords } = harness();
    setRecords([
      {
        rowNumber: 1,
        productKey: 'P1',
        raw: { name: '니트A' },
        version: { name: '니트A' },
        basePrice: 29000,
        categoryIds: [],
        categoryNames: [],
        options: [],
        variantOverrides: [],
        errors: [],
        salesEndDate: '2026-08-31T14:59:59.999Z',
      },
    ]);

    const preview = await service.validate(Buffer.from(''));
    expect(preview.rows[0].resolved.salesPeriod).toBe('시작일 없음 ~ 2026-08-31 23:59');
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
        imageStatus: 'completed',
        commitStatus: 'completed',
        publishStatus: 'running',
        imageError: null,
        commitError: null,
        publishError: null,
        cancelRequestedAt: null,
      },
      itemCounts: [
        { status: 'failed', publishStatus: 'skipped', count: 1 },
        { status: 'created', publishStatus: 'published', count: 3 },
        { status: 'created', publishStatus: 'pending', count: 1 },
      ],
      imageCounts: [],
    });

    const progress = await service.getProgress('sess-1');

    expect(reader.getProgressCounts).toHaveBeenCalledWith('sess-1');
    expect(progress).toMatchObject({ sessionId: 'sess-1', fileName: 'f.xlsx', canceled: false, invalidCount: 1 });
    expect(progress.stages.find((s) => s.key === 'commit')).toMatchObject({ total: 4, done: 4, failed: 0 });
    expect(progress.stages.find((s) => s.key === 'publish')).toMatchObject({ total: 4, done: 3, failed: 0 });
    expect(progress.stages.find((s) => s.key === 'probe')).toMatchObject({ total: 0, done: 0, failed: 0 });
    expect(progress).not.toHaveProperty('items');
  });
});
