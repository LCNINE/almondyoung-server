import { BadRequestException } from '@nestjs/common';
import { PimMedusaMappingRepository } from '../adapters/medusa/pim-medusa-mapping.repository';
import { MAPPING_LOOKUP_MAX_IDS, PimMedusaMappingController } from './pim-medusa-mapping.controller';

function build(findByPimMasterIds = jest.fn(async () => [])) {
  const repository = { findByPimMasterIds } as unknown as PimMedusaMappingRepository;
  return { controller: new PimMedusaMappingController(repository), findByPimMasterIds };
}

describe('PimMedusaMappingController', () => {
  it('쉼표로 나눠 조회하고 매핑 행만 골라 돌려준다', async () => {
    const syncedAt = new Date('2026-08-30T01:02:03.000Z');
    const { controller, findByPimMasterIds } = build(
      jest.fn(async () => [
        {
          id: 'row-1',
          pimMasterId: 'master-a',
          pimVersionId: 'v1',
          pimVersion: 1,
          medusaProductId: 'prod_a',
          medusaHandle: 'handle-a',
          syncStatus: 'synced',
          lastSyncedAt: syncedAt,
          lastSyncAction: 'updated',
          syncErrorCount: 0,
          lastSyncError: null,
          createdAt: syncedAt,
          updatedAt: syncedAt,
        },
      ]) as never,
    );

    const result = await controller.list('master-a, master-b');

    expect(findByPimMasterIds).toHaveBeenCalledWith(['master-a', 'master-b']);
    expect(result.mappings).toEqual([
      {
        pimMasterId: 'master-a',
        medusaProductId: 'prod_a',
        medusaHandle: 'handle-a',
        syncStatus: 'synced',
        lastSyncedAt: '2026-08-30T01:02:03.000Z',
      },
    ]);
  });

  it('같은 id 가 여러 번 와도 한 번만 조회한다', async () => {
    const { controller, findByPimMasterIds } = build();
    await controller.list('master-a,master-a,master-b');
    expect(findByPimMasterIds).toHaveBeenCalledWith(['master-a', 'master-b']);
  });

  it('id 가 하나도 없으면 조회하지 않고 400 이다', async () => {
    const { controller, findByPimMasterIds } = build();
    await expect(controller.list('')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list(' , , ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list(undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(findByPimMasterIds).not.toHaveBeenCalled();
  });

  it('상한을 넘으면 잘라 조회하지 않고 400 으로 막는다 — 무제한 배열은 부하 문이다', async () => {
    const { controller, findByPimMasterIds } = build();
    const ids = Array.from({ length: MAPPING_LOOKUP_MAX_IDS + 1 }, (_, i) => `master-${i}`);
    await expect(controller.list(ids.join(','))).rejects.toBeInstanceOf(BadRequestException);
    expect(findByPimMasterIds).not.toHaveBeenCalled();
  });

  it('상한과 같은 개수는 통과한다', async () => {
    const { controller, findByPimMasterIds } = build();
    const ids = Array.from({ length: MAPPING_LOOKUP_MAX_IDS }, (_, i) => `master-${i}`);
    await controller.list(ids.join(','));
    expect(findByPimMasterIds).toHaveBeenCalledWith(ids);
  });

  it('동기화 실패로 Medusa 상품이 아직 없는 행도 숨기지 않는다 — 화면이 "매핑 없음"을 구분해야 한다', async () => {
    const { controller } = build(
      jest.fn(async () => [
        {
          pimMasterId: 'master-a',
          medusaProductId: null,
          medusaHandle: null,
          syncStatus: 'failed',
          lastSyncedAt: null,
        },
      ]) as never,
    );

    const result = await controller.list('master-a');

    expect(result.mappings).toEqual([
      {
        pimMasterId: 'master-a',
        medusaProductId: null,
        medusaHandle: null,
        syncStatus: 'failed',
        lastSyncedAt: null,
      },
    ]);
  });
});
