import { DbService } from '@app/db';
import { wmsSchema } from '../../schema/inventory.schema';
import { WarehouseManager } from './warehouse.manager';
import { WAREHOUSE_CONSTANTS } from '../../core/constants/warehouse.constants';

describe('WarehouseManager system-location bootstrap', () => {
  it('backfills required system roles for every existing warehouse, including custom warehouses', async () => {
    const reader = {
      findOneOrNull: jest.fn().mockResolvedValue({ id: 'default' }),
      findAll: jest.fn().mockResolvedValue([{ id: 'default-domestic' }, { id: 'custom-warehouse' }]),
    };
    const locationService = { ensureSystemLocations: jest.fn().mockResolvedValue(undefined) };
    const manager = new WarehouseManager({} as DbService<typeof wmsSchema>, reader as never, locationService as never);

    await manager.ensureDefaultsExist();

    expect(locationService.ensureSystemLocations).toHaveBeenCalledTimes(2);
    expect(locationService.ensureSystemLocations).toHaveBeenCalledWith('default-domestic');
    expect(locationService.ensureSystemLocations).toHaveBeenCalledWith('custom-warehouse');
  });
});

describe('WarehouseManager default warehouse seeding', () => {
  // 이 값이 비면 새 환경의 기본 창고는 출고 배치를 만들 수 없는 상태로 태어난다
  // (outbound-batch-orchestrator.service.ts:107 게이트). discrete 는 레거시 동등한
  // 안전 기본값이고, 토탈·멀티오더는 여전히 창고 설정 화면에서 명시적으로 켠다.
  it('기본 창고 상수가 discrete 를 지원 전략으로 갖는다', () => {
    expect(WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.supportedPickingStrategies).toEqual(['discrete']);
    expect(WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE.supportedPickingStrategies).toEqual(['discrete']);
  });

  it('기본 창고가 없으면 지원 전략까지 함께 insert 한다', async () => {
    const values = jest.fn<Promise<void>, [Record<string, unknown>]>().mockResolvedValue(undefined);
    const trx = { insert: jest.fn().mockReturnValue({ values }) };
    const dbService = { run: jest.fn((fn: (trx: typeof trx) => unknown) => fn(trx)) };
    const reader = {
      findOneOrNull: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
    };
    const locationService = { ensureSystemLocations: jest.fn().mockResolvedValue(undefined) };
    const manager = new WarehouseManager(dbService as never, reader as never, locationService as never);

    await manager.ensureDefaultsExist();

    expect(values).toHaveBeenCalledTimes(2);
    for (const call of values.mock.calls) {
      expect(call[0]).toMatchObject({ supportedPickingStrategies: ['discrete'] });
    }
  });
});
