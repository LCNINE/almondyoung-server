import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdvancedInventoryFiltersDto } from './advanced-filters.dto';
import { DeletedSkuFiltersDto } from './deleted-sku-filters.dto';
import { SkuSearchQueryDto } from './sku-search-query.dto';

/**
 * SKU 목록 세 경로의 한 번에 받는 행 수 상한. 상한이 없으면 limit 을 크게 준 요청 하나가
 * 행 전부를 메모리에 올려 core(0.5~1 GB)를 OOM 으로 내린다(2026-11-02 라이브 두 번).
 * 쿼리스트링은 문자열로 오므로 전역 ValidationPipe(transform: true)처럼 plainToInstance 를 거친다.
 */
async function errorsFor<T extends object>(cls: new () => T, query: Record<string, string>) {
  const errors = await validate(plainToInstance(cls, query));
  return errors.map((e) => e.property);
}

describe.each([
  ['GET /inventory/skus', SkuSearchQueryDto],
  ['GET /inventory/skus/search/advanced', AdvancedInventoryFiltersDto],
  ['GET /inventory/skus/deleted', DeletedSkuFiltersDto],
] as const)('%s limit 상한', (_route, cls) => {
  it('200 을 받는다', async () => {
    await expect(errorsFor(cls, { limit: '200' })).resolves.toEqual([]);
  });

  it('201 을 거부한다', async () => {
    await expect(errorsFor(cls, { limit: '201' })).resolves.toEqual(['limit']);
  });

  it('limit 을 생략하면 50 이다', () => {
    expect(plainToInstance(cls, {}).limit).toBe(50);
  });
});

describe('SkuSearchQueryDto', () => {
  it('음수 offset 을 거부한다', async () => {
    await expect(errorsFor(SkuSearchQueryDto, { offset: '-1' })).resolves.toEqual(['offset']);
  });

  it('기존 필터를 그대로 받는다', async () => {
    await expect(
      errorsFor(SkuSearchQueryDto, { barcode: '8801234567890', name: '속눈썹', code: 'SKU-1', supplierName: '가' }),
    ).resolves.toEqual([]);
  });
});
