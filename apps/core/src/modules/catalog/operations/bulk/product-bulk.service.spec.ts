jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);

import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ProductBulkService } from './product-bulk.service';

function makeService(updateExposurePolicy = jest.fn().mockResolvedValue(undefined)) {
  const db = { run: (fn: any, t?: any) => (t ? fn(t) : fn(undefined)) } as any;
  const productVersionsService = { updateExposurePolicy } as any;
  const productMastersService = {} as any;
  const service = new ProductBulkService(db, productVersionsService, productMastersService);
  return { service, productVersionsService };
}

describe('ProductBulkService.bulkUpdatePolicy', () => {
  it('제공된 정책을 각 master 에 적용하고 updated 카운트를 반환한다', async () => {
    const { service, productVersionsService } = makeService();
    const result = await service.bulkUpdatePolicy({ productIds: ['m1', 'm2'], isOverseas: true });

    expect(productVersionsService.updateExposurePolicy).toHaveBeenCalledTimes(2);
    expect(productVersionsService.updateExposurePolicy).toHaveBeenCalledWith('m1', { isOverseas: true }, undefined);
    expect(result).toEqual({ updated: 2, failed: [] });
  });

  it('active 버전이 없는 master 는 failed 로 수집하고 나머지는 계속한다', async () => {
    const updateExposurePolicy = jest
      .fn()
      .mockImplementation((masterId: string) =>
        masterId === 'm2' ? Promise.reject(new NotFoundException('no active version')) : Promise.resolve(undefined),
      );
    const { service } = makeService(updateExposurePolicy);
    const result = await service.bulkUpdatePolicy({
      productIds: ['m1', 'm2', 'm3'],
      isVisibleToMembersOnly: true,
    });

    expect(result.updated).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].masterId).toBe('m2');
  });

  it('변경할 플래그가 없으면 BadRequestException', async () => {
    const { service } = makeService();
    await expect(service.bulkUpdatePolicy({ productIds: ['m1'] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('스냅샷 조립 불가(BadRequestException) master 는 failed 로 수집하고 나머지는 계속한다', async () => {
    const updateExposurePolicy = jest.fn().mockImplementation((masterId: string) =>
      masterId === 'm2'
        ? Promise.reject(new BadRequestException('활성 variant 가 없습니다'))
        : Promise.resolve(undefined),
    );
    const { service } = makeService(updateExposurePolicy);
    const result = await service.bulkUpdatePolicy({ productIds: ['m1', 'm2', 'm3'], isOverseas: true });

    expect(result.updated).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toEqual({ masterId: 'm2', name: null, reason: '활성 variant 가 없습니다' });
  });

  it('NotFound/BadRequest 외 에러는 rethrow 한다', async () => {
    const updateExposurePolicy = jest.fn().mockRejectedValue(new Error('db down'));
    const { service } = makeService(updateExposurePolicy);
    await expect(
      service.bulkUpdatePolicy({ productIds: ['m1'], isOverseas: true }),
    ).rejects.toThrow('db down');
  });
});
