import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { Test } from '@nestjs/testing';
import { DEFAULT_WAGE_RULES } from '@packages/domain-types/attendance-wage';
import { WageSettingsManager } from './wage-settings.manager';
import { WageRepository } from './wage.repository';

const actor = '00000000-0000-4000-8000-0000000000aa';
const worker = '00000000-0000-4000-8000-0000000000bb';
const groupId = '00000000-0000-4000-8000-0000000000cc';

const group = {
  id: groupId,
  name: '시급제',
  payBasis: 'hourly' as const,
  payday: 23,
  periodCloseDay: 0,
  payMonthOffset: 1 as const,
  active: true,
  version: 3,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

const roster = {
  userId: worker,
  groupId,
  hireDate: null,
  leaveDate: null,
  label: null,
  note: null,
  version: 1,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

const contractRate = {
  id: '00000000-0000-4000-8000-0000000000dd',
  userId: worker,
  effectiveFrom: '2026-11-01',
  hourlyWage: 11000,
  createdBy: actor,
  createdAt: new Date('2026-10-01T00:00:00Z'),
};

describe('WageSettingsManager', () => {
  const tx = { marker: 'tx' };
  const events: string[] = [];
  const repository = {
    run: jest.fn((work: (tx: object) => Promise<unknown>) => {
      events.push('begin');

      return work(tx).finally(() => events.push('end'));
    }),
    group: jest.fn(),
    insertGroup: jest.fn(),
    updateGroup: jest.fn(),
    policies: jest.fn(),
    insertPolicy: jest.fn(),
    worker: jest.fn(),
    insertWorker: jest.fn(),
    updateWorker: jest.fn(),
    userName: jest.fn(),
    insertRate: jest.fn(),
    schedules: jest.fn(),
    insertSchedule: jest.fn(),
    insertMinimumWage: jest.fn(),
    confirmedThrough: jest.fn(),
    hasConfirmed: jest.fn(),
    personConfirmedThrough: jest.fn(),
    rate: jest.fn(),
    rates: jest.fn(),
    updateRate: jest.fn(),
    deleteRate: jest.fn(),
    schedule: jest.fn(),
    updateSchedule: jest.fn(),
    deleteSchedule: jest.fn(),
    policy: jest.fn(),
    updatePolicy: jest.fn(),
    deletePolicy: jest.fn(),
    updateMinimumWage: jest.fn(),
    deleteMinimumWage: jest.fn(),
    deleteWorker: jest.fn(),
    groupInUse: jest.fn(),
    deleteGroup: jest.fn(),
    lockGroup: jest.fn((_tx: object, id: string) => {
      events.push(`lock:${id}`);

      return Promise.resolve();
    }),
    audit: jest.fn((_tx: object, entry: { kind: string }) => {
      events.push(entry.kind);

      return Promise.resolve();
    }),
  };
  let manager: WageSettingsManager;

  beforeEach(async () => {
    jest.clearAllMocks();
    events.length = 0;
    repository.group.mockResolvedValue(group);
    repository.worker.mockResolvedValue(roster);
    repository.userName.mockResolvedValue('근무자');
    repository.policies.mockResolvedValue([]);
    repository.schedules.mockResolvedValue([]);
    repository.confirmedThrough.mockResolvedValue(false);
    repository.hasConfirmed.mockResolvedValue(false);
    repository.personConfirmedThrough.mockResolvedValue(false);
    repository.rate.mockResolvedValue(contractRate);
    repository.rates.mockResolvedValue([contractRate]);
    repository.updateRate.mockImplementation((_tx: object, _id: string, values: object) =>
      Promise.resolve({ ...contractRate, ...values }),
    );
    repository.deleteRate.mockResolvedValue(true);
    repository.groupInUse.mockResolvedValue(false);

    const module = await Test.createTestingModule({
      providers: [WageSettingsManager, { provide: WageRepository, useValue: repository }],
    }).compile();

    manager = module.get(WageSettingsManager);
  });

  it('rejects a stale group version', async () => {
    repository.updateGroup.mockResolvedValue(null);

    await expect(manager.updateGroup(actor, groupId, { version: 2, name: '새 이름' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(repository.audit).not.toHaveBeenCalled();
  });

  it('refuses to move the pay calendar of a group with a confirmed period', async () => {
    repository.hasConfirmed.mockResolvedValue(true);

    await expect(manager.updateGroup(actor, groupId, { version: 3, periodCloseDay: 15 })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(repository.updateGroup).not.toHaveBeenCalled();
  });

  it('still renames a group with a confirmed period', async () => {
    repository.hasConfirmed.mockResolvedValue(true);
    repository.updateGroup.mockResolvedValue({ ...group, name: '새 이름', version: 4 });

    await expect(
      manager.updateGroup(actor, groupId, { version: 3, name: '새 이름', payday: 23 }),
    ).resolves.toMatchObject({
      name: '새 이름',
    });
  });

  it('turns a concurrent schedule with the same start into a conflict', async () => {
    repository.insertSchedule.mockResolvedValue(null);

    await expect(
      manager.addSchedule(actor, worker, {
        effectiveFrom: '2026-11-01',
        days: [{ weekday: 1, start: '09:00', end: '13:00' }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('answers not found for a missing group', async () => {
    repository.group.mockResolvedValue(null);

    await expect(manager.updateGroup(actor, groupId, { version: 3 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('validates rules before saving a policy', async () => {
    await expect(
      manager.addPolicy(actor, groupId, {
        effectiveFrom: '2026-11-01',
        rules: { ...DEFAULT_WAGE_RULES, overtime: { ...DEFAULT_WAGE_RULES.overtime, rate: 0.5 } },
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(repository.insertPolicy).not.toHaveBeenCalled();
  });

  it('starts a new group with the default rules from the first of the given month', async () => {
    repository.insertGroup.mockResolvedValue(group);
    repository.insertPolicy.mockResolvedValue({});

    await manager.createGroup(actor, {
      name: '시급제',
      payBasis: 'hourly',
      payday: 23,
      periodCloseDay: 0,
      payMonthOffset: 1,
      rulesEffectiveFrom: '2026-10-01',
    });

    expect(repository.insertPolicy).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ groupId, effectiveFrom: '2026-10-01', rules: DEFAULT_WAGE_RULES }),
    );
    expect(events).toEqual(['begin', 'wage.group.created', 'end']);
  });

  it('rejects two schedules that start on the same day', async () => {
    repository.schedules.mockResolvedValue([{ effectiveFrom: '2026-11-01' }]);

    await expect(
      manager.addSchedule(actor, worker, {
        effectiveFrom: '2026-11-01',
        days: [{ weekday: 1, start: '09:00', end: '13:00' }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a schedule that ends before it starts', async () => {
    await expect(
      manager.addSchedule(actor, worker, {
        effectiveFrom: '2026-11-10',
        effectiveTo: '2026-11-01',
        days: [{ weekday: 1, start: '09:00', end: '13:00' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects a rate change inside a confirmed period', async () => {
    repository.confirmedThrough.mockResolvedValue(true);

    await expect(manager.addRate(actor, worker, { effectiveFrom: '2026-10-15', hourlyWage: 11000 })).rejects.toThrow(
      '확정한 기간 안의 시급은 바꿀 수 없어요. 정산을 다시 연 뒤 바꿔 주세요.',
    );
    expect(repository.confirmedThrough).toHaveBeenCalledWith(tx, groupId, '2026-10-15');
    expect(repository.insertRate).not.toHaveBeenCalled();
  });

  it('asks to add the person to the roster before setting a rate', async () => {
    repository.worker.mockResolvedValue(null);

    await expect(
      manager.addRate(actor, worker, { effectiveFrom: '2026-11-01', hourlyWage: 11000 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a second rate starting the same day', async () => {
    repository.insertRate.mockResolvedValue(null);

    await expect(
      manager.addRate(actor, worker, { effectiveFrom: '2026-11-01', hourlyWage: 11000 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('requires the version to change a roster entry', async () => {
    await expect(manager.saveWorker(actor, worker, { groupId })).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a leave date before the hire date', async () => {
    repository.worker.mockResolvedValue(null);

    await expect(
      manager.saveWorker(actor, worker, { groupId, hireDate: '2026-11-01', leaveDate: '2026-10-01' }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('writes one audit row per change in the same transaction', async () => {
    repository.insertRate.mockResolvedValue({ id: 'rate', effectiveFrom: '2026-11-01', hourlyWage: 11000 });

    await manager.addRate(actor, worker, { effectiveFrom: '2026-11-01', hourlyWage: 11000 });

    expect(events).toEqual(['begin', `lock:${groupId}`, 'wage.rate.created', 'end']);
    expect(repository.audit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ actorId: actor, subjectId: worker, entityId: 'rate' }),
    );
  });

  describe('editing what was entered', () => {
    it('corrects a contracted rate in place', async () => {
      await expect(manager.updateRate(actor, worker, contractRate.id, { hourlyWage: 12000 })).resolves.toMatchObject({
        hourlyWage: 12000,
      });
      expect(repository.updateRate).toHaveBeenCalledWith(tx, contractRate.id, {
        effectiveFrom: '2026-11-01',
        hourlyWage: 12000,
      });
      expect(events).toEqual(['begin', `lock:${groupId}`, 'wage.rate.updated', 'end']);
    });

    it('checks the earlier of the old and new start against confirmed periods', async () => {
      repository.confirmedThrough.mockResolvedValue(true);

      await expect(
        manager.updateRate(actor, worker, contractRate.id, { effectiveFrom: '2026-10-15' }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(repository.confirmedThrough).toHaveBeenCalledWith(tx, groupId, '2026-10-15');
      expect(repository.updateRate).not.toHaveBeenCalled();
    });

    it('refuses to move a rate onto a day that already has one', async () => {
      repository.rates.mockResolvedValue([contractRate, { ...contractRate, id: 'other', effectiveFrom: '2026-12-01' }]);

      await expect(
        manager.updateRate(actor, worker, contractRate.id, { effectiveFrom: '2026-12-01' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('answers not found for a rate of someone else', async () => {
      repository.rate.mockResolvedValue({ ...contractRate, userId: actor });

      await expect(manager.deleteRate(actor, worker, contractRate.id)).rejects.toBeInstanceOf(NotFoundError);
      expect(repository.deleteRate).not.toHaveBeenCalled();
    });

    it('deletes a rate outside confirmed periods', async () => {
      await manager.deleteRate(actor, worker, contractRate.id);

      expect(repository.deleteRate).toHaveBeenCalledWith(tx, contractRate.id);
      expect(events).toContain('wage.rate.deleted');
    });

    it('refuses to change a rate used by a period confirmed in a previous group', async () => {
      repository.personConfirmedThrough.mockResolvedValue(true);

      await expect(manager.updateRate(actor, worker, contractRate.id, { hourlyWage: 12000 })).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(repository.personConfirmedThrough).toHaveBeenCalledWith(tx, worker, '2026-11-01');
    });

    it('treats the first rule set as covering every earlier period', async () => {
      const first = { id: 'p1', groupId, effectiveFrom: '2026-10-01', rules: DEFAULT_WAGE_RULES };

      repository.policy.mockResolvedValue(first);
      repository.policies.mockResolvedValue([first, { ...first, id: 'p2', effectiveFrom: '2026-12-01' }]);
      repository.confirmedThrough.mockImplementation((_tx: object, _group: string, from: string) =>
        Promise.resolve(from <= '2026-09-30'),
      );

      await expect(manager.deletePolicy(actor, groupId, 'p1')).rejects.toBeInstanceOf(ConflictError);
      expect(repository.confirmedThrough).toHaveBeenCalledWith(tx, groupId, '1900-01-01');
    });

    it('re-reads the roster after the lock and gives up if the person moved', async () => {
      repository.worker.mockResolvedValueOnce(roster).mockResolvedValueOnce({ ...roster, groupId: 'other' });

      await expect(manager.removeWorker(actor, worker)).rejects.toBeInstanceOf(ConflictError);
      expect(repository.deleteWorker).not.toHaveBeenCalled();
    });

    it('keeps at least one rule set in a group', async () => {
      repository.policy.mockResolvedValue({ id: 'p1', groupId, effectiveFrom: '2026-01-01', rules: {} });
      repository.policies.mockResolvedValue([{ id: 'p1', effectiveFrom: '2026-01-01' }]);

      await expect(manager.deletePolicy(actor, groupId, 'p1')).rejects.toBeInstanceOf(ConflictError);
      expect(repository.deletePolicy).not.toHaveBeenCalled();
    });

    it('rejects a schedule edit that ends before it starts', async () => {
      repository.schedule.mockResolvedValue({
        id: 's1',
        userId: worker,
        effectiveFrom: '2026-11-01',
        effectiveTo: null,
        days: [],
      });

      await expect(manager.updateSchedule(actor, worker, 's1', { effectiveTo: '2026-10-01' })).rejects.toBeInstanceOf(
        BadRequestError,
      );
    });

    it('deletes a group only while nothing depends on it', async () => {
      repository.groupInUse.mockResolvedValue(true);

      await expect(manager.deleteGroup(actor, groupId)).rejects.toBeInstanceOf(ConflictError);
      expect(repository.deleteGroup).not.toHaveBeenCalled();
    });

    it('takes a person off the roster with a trail', async () => {
      repository.deleteWorker.mockResolvedValue(true);

      await manager.removeWorker(actor, worker);

      expect(repository.deleteWorker).toHaveBeenCalledWith(tx, worker);
      expect(events).toContain('wage.worker.removed');
    });
  });
});
