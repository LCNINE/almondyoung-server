import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { BadRequestError } from '@app/shared';
import { ProductMasterMapper } from '../../core/products/mappers';
import { ProductExportService } from './product-export.service';

/**
 * 예전엔 getMasters 를 page 없이 불러 걸린 상품을 한 번에 다 읽고, 5만 건 상한은 다 읽은 «뒤에»
 * 검사했다. 필터 없는 전체 내보내기가 core 를 OOM 으로 내린 요청과 같은 일을 했다(2026-11-02).
 * 이제 묶음으로 읽고, 상한 초과는 첫 묶음에서 거절한다.
 *
 * 묶음을 전부 읽은 뒤에 응답을 시작하면 1만 건(10묶음, 라이브 약 40초)이 admin-web 프록시의
 * 헤더 대기 30초를 넘겨 504 가 났다(2026-11-03). 그래서 첫 묶음만 응답 전에 읽고 나머지는 쓰면서 읽는다.
 */
async function drain(stream: Readable): Promise<void> {
  stream.resume();
  await finished(stream);
}

describe('ProductExportService 묶음 읽기', () => {
  function makeService(total: number, gate?: Promise<void>) {
    const getMasters = jest.fn(async (filters: { page?: number; limit?: number }) => {
      if (gate && (filters.page ?? 1) > 1) await gate;
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
      .mockImplementation(
        (p) => ({ id: (p as { id: string }).id, supplierId: null, optionGroupNames: [], priceSummary: null }) as never,
      );
  });

  afterEach(() => jest.restoreAllMocks());

  it('1,000 건씩 끝까지 읽는다', async () => {
    const { service, getMasters } = makeService(2_500);

    const { stream, rowCount } = await service.export({ filters: { name: '립' } });
    await drain(stream);

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

  it('응답은 첫 묶음만 기다린다 — 나머지는 스트림을 쓰면서 읽는다', async () => {
    let release!: () => void;
    const { service, getMasters } = makeService(2_500, new Promise((resolve) => (release = resolve)));

    // 2번째 묶음이 막혀 있어도 돌아와야 한다(예전엔 전부 읽은 뒤에야 돌아와 프록시가 504 를 냈다).
    const { stream, rowCount } = await service.export({});
    expect(rowCount).toBe(2_500);

    release();
    await drain(stream);
    expect(getMasters).toHaveBeenCalledTimes(3);
  });

  it('받는 쪽이 끊으면 다음 묶음을 읽지 않는다', async () => {
    let release!: () => void;
    const { service, getMasters } = makeService(2_500, new Promise((resolve) => (release = resolve)));

    const { stream } = await service.export({});
    stream.destroy();
    release();
    await new Promise((resolve) => setImmediate(resolve));

    expect(getMasters).toHaveBeenCalledTimes(2);
  });

  it('5만 건을 넘으면 첫 묶음만 읽고 거절한다', async () => {
    const { service, getMasters } = makeService(50_001);

    await expect(service.export({})).rejects.toBeInstanceOf(BadRequestError);
    expect(getMasters).toHaveBeenCalledTimes(1);
  });

  it('선택항목은 ids 로 묶음을 읽는다', async () => {
    const { service, getMasters } = makeService(2);

    const { stream, rowCount } = await service.export({ ids: ['a', 'b'] });
    await drain(stream);

    expect(rowCount).toBe(2);
    expect(getMasters.mock.calls[0][0]).toMatchObject({ ids: ['a', 'b'], mode: 'all', page: 1, limit: 1000 });
  });
});
