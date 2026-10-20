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
});
