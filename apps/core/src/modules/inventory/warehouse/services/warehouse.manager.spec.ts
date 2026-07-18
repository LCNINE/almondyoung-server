import { DbService } from '@app/db';
import { wmsSchema } from '../../schema/inventory.schema';
import { WarehouseManager } from './warehouse.manager';

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
