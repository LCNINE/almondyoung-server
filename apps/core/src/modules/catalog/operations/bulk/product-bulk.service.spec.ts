jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);
jest.mock('../../core/products/services/product-audit-log', () => ({
  ...jest.requireActual('../../core/products/services/product-audit-log'),
  recordProductAudit: jest.fn().mockResolvedValue(undefined),
}));

import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ProductBulkService } from './product-bulk.service';
import { recordProductAudit } from '../../core/products/services/product-audit-log';

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
    const result = await service.bulkUpdatePolicy({ productIds: ['m1', 'm2'], isOverseas: true }, 'user-1');

    expect(productVersionsService.updateExposurePolicy).toHaveBeenCalledTimes(2);
    expect(productVersionsService.updateExposurePolicy).toHaveBeenCalledWith(
      'm1',
      { isOverseas: true },
      'user-1',
      undefined,
    );
    expect(result).toEqual({ updated: 2, failed: [] });
  });

  it('active 버전이 없는 master 는 failed 로 수집하고 나머지는 계속한다', async () => {
    const updateExposurePolicy = jest
      .fn()
      .mockImplementation((masterId: string) =>
        masterId === 'm2' ? Promise.reject(new NotFoundException('no active version')) : Promise.resolve(undefined),
      );
    const { service } = makeService(updateExposurePolicy);
    const result = await service.bulkUpdatePolicy(
      {
        productIds: ['m1', 'm2', 'm3'],
        isVisibleToMembersOnly: true,
      },
      'user-1',
    );

    expect(result.updated).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].masterId).toBe('m2');
  });

  it('변경할 플래그가 없으면 BadRequestException', async () => {
    const { service } = makeService();
    await expect(service.bulkUpdatePolicy({ productIds: ['m1'] }, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('스냅샷 조립 불가(BadRequestException) master 는 failed 로 수집하고 나머지는 계속한다', async () => {
    const updateExposurePolicy = jest
      .fn()
      .mockImplementation((masterId: string) =>
        masterId === 'm2'
          ? Promise.reject(new BadRequestException('활성 variant 가 없습니다'))
          : Promise.resolve(undefined),
      );
    const { service } = makeService(updateExposurePolicy);
    const result = await service.bulkUpdatePolicy({ productIds: ['m1', 'm2', 'm3'], isOverseas: true }, 'user-1');

    expect(result.updated).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toEqual({ masterId: 'm2', name: null, reason: '활성 variant 가 없습니다' });
  });

  it('NotFound/BadRequest 외 에러는 rethrow 한다', async () => {
    const updateExposurePolicy = jest.fn().mockRejectedValue(new Error('db down'));
    const { service } = makeService(updateExposurePolicy);
    await expect(service.bulkUpdatePolicy({ productIds: ['m1'], isOverseas: true }, 'user-1')).rejects.toThrow(
      'db down',
    );
  });
});

describe('ProductBulkService.bulkUpdate 판매중단', () => {
  it('판매중단과 함께 바꾼 브랜드를 이전/이후 값으로 남긴다', async () => {
    const activeVersion = { id: 'v1', masterId: 'm1', brand: 'OLD', seller: '본사' };
    const productVersionsService = {
      getActiveVersion: jest.fn().mockResolvedValue(activeVersion),
      unpublishMaster: jest.fn().mockResolvedValue(undefined),
    };
    const tx = { update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn() })) })) };
    const db = { run: (fn: (t: unknown) => unknown) => fn(tx) };
    const service = new ProductBulkService(db as any, productVersionsService as any, {} as any);

    await service.bulkUpdate({ productIds: ['m1'], status: 'inactive', brand: 'NEW' }, 'user-1');

    expect(productVersionsService.unpublishMaster).toHaveBeenCalledWith('m1', 'user-1', tx);
    expect(recordProductAudit).toHaveBeenCalledWith(tx, {
      masterId: 'm1',
      versionId: 'v1',
      action: 'bulk_updated',
      userId: 'user-1',
      changes: { brand: { old: 'OLD', new: 'NEW' } },
    });
  });
});
