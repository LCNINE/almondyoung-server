import { DbService } from '@app/db';
import { wmsSchema } from '../../schema/inventory.schema';
import { SYSTEM_LOCATION_DEFAULTS, SYSTEM_LOCATION_ROLES } from '../constants/warehouse.constants';
import { LocationService } from './location.service';

describe('LocationService system locations', () => {
  it('bootstraps all four required roles with conflict-safe inserts', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const roles = Object.keys(SYSTEM_LOCATION_DEFAULTS);
    let selectedRole = 0;
    const trx = {
      insert: jest.fn(() => ({
        values: jest.fn((value: Record<string, unknown>) => {
          inserted.push(value);
          return { onConflictDoNothing: jest.fn().mockResolvedValue(undefined) };
        }),
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            for: jest.fn(() => ({
              limit: jest.fn().mockImplementation(() => {
                const role = roles[selectedRole++];
                return Promise.resolve([{ id: `location-${role}`, isActive: true, systemRole: role }]);
              }),
            })),
          })),
        })),
      })),
    };
    const dbService = {
      db: trx,
      run: jest.fn((fn: (value: typeof trx) => unknown) => fn(trx)),
    } as unknown as DbService<typeof wmsSchema>;

    await new LocationService(dbService).ensureSystemLocations('warehouse-1');

    expect(inserted).toHaveLength(4);
    expect(inserted.map((row) => row.systemRole)).toEqual([
      SYSTEM_LOCATION_ROLES.INBOUND_DEFAULT,
      SYSTEM_LOCATION_ROLES.RETURN_DEFAULT,
      SYSTEM_LOCATION_ROLES.OUTBOUND_REWORK,
      SYSTEM_LOCATION_ROLES.TRANSIT_OUT,
    ]);
    expect(inserted[2]).toMatchObject({
      code: 'zone-outbound-rework',
      isSystem: true,
      isActive: true,
      locationType: 'zone',
    });
    // 운송중존이 없으면 창고간 이동의 선적이 IN_TRANSFER 를 매달 곳을 못 찾아
    // getSystemLocationByRole 에서 터진다 — 모든 창고에 있어야 한다.
    expect(inserted[3]).toMatchObject({
      code: 'zone-transit-out',
      isSystem: true,
      isActive: true,
      locationType: 'zone',
    });
  });

  it.each([
    [{ displayName: 'renamed' }, 'renamed'],
    [{ isActive: false }, 'deactivated'],
    [{ systemRole: 'return_default' }, 'role cannot be changed'],
  ])('rejects protected system location mutation %j', async (dto, message) => {
    const existing = {
      id: 'location-1',
      warehouseId: 'warehouse-1',
      code: 'zone-outbound-rework',
      displayName: '출고 재작업존',
      locationType: 'zone',
      rackId: null,
      binIdentifier: null,
      isSystem: true,
      systemRole: 'outbound_rework',
      isActive: true,
    };
    const returning = jest.fn();
    const db = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([existing]) })) })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({ where: jest.fn(() => ({ returning })) })),
      })),
    };
    const dbService = { db } as unknown as DbService<typeof wmsSchema>;
    const service = new LocationService(dbService);

    await expect(service.updateLocation(existing.id, dto as never)).rejects.toThrow(message);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects deletion of OUTBOUND_REWORK', async () => {
    const db = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([{ id: 'location-1', isSystem: true, systemRole: 'outbound_rework' }]),
          })),
        })),
      })),
      delete: jest.fn(),
    };
    const service = new LocationService({ db } as unknown as DbService<typeof wmsSchema>);

    await expect(service.deleteLocation('location-1')).rejects.toThrow('System location cannot be deleted');
    expect(db.delete).not.toHaveBeenCalled();
  });
});
