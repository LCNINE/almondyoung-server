import { Logger } from '@nestjs/common';
import { aggMembershipDaily } from '../../../schema';
import { MembershipDailySnapshotService } from './membership-daily-snapshot.service';

let logSpy: jest.SpyInstance;

beforeEach(() => {
  logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

describe('MembershipDailySnapshotService', () => {
  function makeService(openIntervalRows: Array<{ tierId: string; membersCount: number }>) {
    const deleted: unknown[] = [];
    const inserted: Array<Record<string, unknown>> = [];

    const executor = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            groupBy: jest.fn().mockResolvedValue(openIntervalRows),
          }),
        }),
      }),
      delete: jest.fn((table: unknown) => {
        if (table !== aggMembershipDaily) {
          throw new Error('Unexpected analytics table');
        }
        return {
          where: jest.fn((condition: unknown) => {
            deleted.push(condition);
            return Promise.resolve(undefined);
          }),
        };
      }),
      insert: jest.fn((table: unknown) => {
        if (table !== aggMembershipDaily) {
          throw new Error('Unexpected analytics table');
        }
        return {
          values: jest.fn((values: Array<Record<string, unknown>>) => {
            inserted.push(...values);
            return Promise.resolve(undefined);
          }),
        };
      }),
    };

    const run = jest.fn((fn: (e: unknown) => unknown, tx?: unknown) => (tx ? fn(tx) : fn(executor)));
    const dbService = { run };
    return { service: new MembershipDailySnapshotService(dbService as never), executor, deleted, inserted };
  }

  it('열린 구간을 tier 별로 세어 그날 ACTIVE 행으로 대입한다 (지우고 다시 쓴다)', async () => {
    const { service, deleted, inserted } = makeService([
      { tierId: 'tier-1', membersCount: 3 },
      { tierId: 'UNKNOWN', membersCount: 1 },
    ]);

    await service.snapshotFor('2026-08-24');

    expect(deleted).toHaveLength(1);
    expect(inserted).toHaveLength(2);
    expect(inserted).toContainEqual(
      expect.objectContaining({ aggDate: '2026-08-24', status: 'ACTIVE', tierId: 'tier-1', membersCount: 3 }),
    );
    expect(inserted).toContainEqual(
      expect.objectContaining({ aggDate: '2026-08-24', status: 'ACTIVE', tierId: 'UNKNOWN', membersCount: 1 }),
    );
  });

  it('열린 구간이 없으면 지우기만 하고 insert 하지 않는다', async () => {
    const { service, executor, deleted, inserted } = makeService([]);

    await service.snapshotFor('2026-08-24');

    expect(deleted).toHaveLength(1);
    expect(inserted).toHaveLength(0);
    expect(executor.insert).not.toHaveBeenCalled();
  });
});
