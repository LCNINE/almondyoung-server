import { createCheckpointsForTesting, type JwtPayload, PermissionCheckpoints } from '@app/authorization';
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AttendanceRepository } from '../repositories/attendance.repository';
import { AttendanceCalendarService } from '../services/attendance-calendar.service';
import { AttendanceRequestManager } from '../services/attendance-request.manager';
import { AttendanceService } from '../services/attendance.service';
import { AttendanceRequestsController } from './attendance-requests.controller';
import { AttendanceController } from './attendance.controller';

type ByRole = Readonly<Record<string, readonly string[]>> | null | undefined;

const SELF = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const REQUEST = '00000000-0000-4000-8000-000000000003';

const person = (roles: string[]): JwtPayload => ({ id: SELF, email: '', roles });

describe('Attendance permission checkpoints', () => {
  const requestManager = {
    history: jest.fn<Promise<unknown[]>, [string, boolean, string]>().mockResolvedValue([]),
    decide: jest.fn<Promise<unknown>, [string, boolean, string, unknown]>().mockResolvedValue({}),
  };
  const where = jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([]);
  const repo = {
    withUserLock: jest.fn(() => Promise.resolve(null)),
    settings: jest.fn(() => Promise.resolve({})),
    staff: jest.fn(() => Promise.resolve([])),
    records: jest.fn(() => Promise.resolve([])),
    db: { select: () => ({ from: () => ({ where }) }) },
  };
  const calendar = { list: jest.fn(() => Promise.resolve([])) };

  async function controllers(byRole: ByRole) {
    const module = await Test.createTestingModule({
      controllers: [AttendanceController, AttendanceRequestsController],
      providers: [
        { provide: AttendanceService, useValue: {} },
        { provide: AttendanceRepository, useValue: repo },
        { provide: AttendanceCalendarService, useValue: calendar },
        { provide: AttendanceRequestManager, useValue: requestManager },
        { provide: PermissionCheckpoints, useValue: createCheckpointsForTesting(byRole) },
      ],
    }).compile();
    return { attendance: module.get(AttendanceController), requests: module.get(AttendanceRequestsController) };
  }

  async function verdicts(byRole: ByRole, roles: string[]) {
    jest.clearAllMocks();
    const { attendance, requests } = await controllers(byRole);
    const user = person(roles);
    await requests.history(user, REQUEST);
    await requests.decide(user, REQUEST, { version: 1, status: 'approved', reason: '' });
    const me = await attendance.me(user);
    const records = await attendance.records(user, OTHER).then(
      () => true,
      (error: unknown) => {
        if (error instanceof ForbiddenException) return false;
        throw error;
      },
    );
    await attendance.sites(user);
    return {
      requestHistory: requestManager.history.mock.calls[0]?.[1],
      requestDecision: requestManager.decide.mock.calls[0]?.[1],
      managerView: me.isMaster,
      staffRecords: records,
      inactiveWorksites: where.mock.calls.at(-1)?.[0] === undefined,
    };
  }

  const none = {
    requestHistory: false,
    requestDecision: false,
    managerView: false,
    staffRecords: false,
    inactiveWorksites: false,
  };
  const all = {
    requestHistory: true,
    requestDecision: true,
    managerView: true,
    staffRecords: true,
    inactiveWorksites: true,
  };

  it('opens each manager view to a role that holds the attendance permissions', async () => {
    const byRole = { lead: ['attendance.staff.read', 'attendance.request.review'] };
    expect(await verdicts(byRole, ['lead'])).toEqual(all);
  });

  it('separates staff reading from request review', async () => {
    expect(await verdicts({ reader: ['attendance.staff.read'] }, ['reader'])).toEqual({
      ...all,
      requestDecision: false,
    });
    expect(await verdicts({ reviewer: ['attendance.request.review'] }, ['reviewer'])).toEqual({
      ...none,
      requestDecision: true,
    });
  });

  it('does not open anything by an old role name alone', async () => {
    expect(await verdicts({ master: [] }, ['master'])).toEqual(none);
  });

  it('follows the real first-grant map: master manages, admin does not', async () => {
    expect(await verdicts(undefined, ['master'])).toEqual(all);
    expect(await verdicts(undefined, ['admin'])).toEqual(none);
  });

  it('closes every manager view before the permission copy arrives', async () => {
    expect(await verdicts(null, ['master'])).toEqual(none);
  });

  it('lets anyone read their own records without a staff permission', async () => {
    jest.clearAllMocks();
    const { attendance } = await controllers({ admin: [] });
    await expect(attendance.records(person(['admin']), SELF)).resolves.toEqual([]);
    expect(repo.records).toHaveBeenCalledWith(SELF);
  });
});
