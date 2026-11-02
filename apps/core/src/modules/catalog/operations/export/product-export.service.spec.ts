import { BadRequestError } from '@app/shared';
import { ProductMasterMapper } from '../../core/products/mappers';
import { ProductExportService } from './product-export.service';

/**
 * 예전엔 getMasters 를 page 없이 불러 걸린 상품을 한 번에 다 읽고, 5만 건 상한은 다 읽은 «뒤에»
 * 검사했다. 필터 없는 전체 내보내기가 core 를 OOM 으로 내린 요청과 같은 일을 했다(2026-11-02).
 * 이제 묶음으로 읽고, 상한 초과는 첫 묶음에서 거절한다.
 */
describe('ProductExportService 묶음 읽기', () => {
  function makeService(total: number) {
    const getMasters = jest.fn(async (filters: { page?: number; limit?: number }) => {
      const limit = filters.limit ?? 0;
      const start = ((filters.page ?? 1) - 1) * limit;
      const n = Math.max(0, Math.min(limit, total - start));
      return {
        data: Array.from({ length: n }, (_, i) => ({ product: { id: `m-${start + i}` }, aggregate: {} })),
        total,
        page: filters.page ?? 1,
        limit,
      };
    });
    const suppliers = { getSuppliers: jest.fn().mockResolvedValue({ data: [] }) };
    const service = new ProductExportService({ getMasters } as never, suppliers as never);
    return { service, getMasters };
  }

  beforeEach(() => {
    jest
      .spyOn(ProductMasterMapper, 'toProductSummary')
      .mockImplementation((p) => ({ id: (p as { id: string }).id, supplierId: null }) as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('1,000 건씩 끝까지 읽는다', async () => {
    const { service, getMasters } = makeService(2_500);

    const { stream, rowCount } = await service.export({ filters: { name: '립' } });
    stream.resume();

    expect(rowCount).toBe(2_500);
    expect(getMasters.mock.calls.map(([f]) => [f.page, f.limit])).toEqual([
      [1, 1000],
      [2, 1000],
      [3, 1000],
    ]);
    for (const [filters, , options] of getMasters.mock.calls as unknown as [object, unknown, object][]) {
      expect(filters).toMatchObject({ name: '립' });
      expect(options).toEqual({ maxLimit: 1000, withPreviews: false });
    }
  });

  it('5만 건을 넘으면 첫 묶음만 읽고 거절한다', async () => {
    const { service, getMasters } = makeService(50_001);

    await expect(service.export({})).rejects.toBeInstanceOf(BadRequestError);
    expect(getMasters).toHaveBeenCalledTimes(1);
  });

  it('선택항목은 ids 로 묶음을 읽는다', async () => {
    const { service, getMasters } = makeService(2);

    const { stream, rowCount } = await service.export({ ids: ['a', 'b'] });
    stream.resume();

    expect(rowCount).toBe(2);
    expect(getMasters.mock.calls[0][0]).toMatchObject({ ids: ['a', 'b'], mode: 'all', page: 1, limit: 1000 });
  });
});
