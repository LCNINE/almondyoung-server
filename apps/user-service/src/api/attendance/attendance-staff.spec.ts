import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { ATTENDANCE_STAFF_PERMISSION, AttendanceStaffUnavailableError, rolesHoldingOrThrow } from './attendance-staff';
import { ActiveAttendanceStaffGuard } from './guards/active-attendance-staff.guard';

class Probe {}

const handler = (): void => undefined;

const contextFor = (userId: string) => {
  const host = new ExecutionContextHost([{ user: { id: userId } }, {}], Probe, handler);

  host.setType('http');

  return host;
};

describe('attendance staff lookup', () => {
  it('asks the permission copy which roles count as staff', () => {
    const asked: string[] = [];
    const lookup = {
      rolesHolding: (permission: string) => {
        asked.push(permission);

        return ['admin', 'master'];
      },
    };

    expect(rolesHoldingOrThrow(lookup, ATTENDANCE_STAFF_PERMISSION)).toEqual(['admin', 'master']);
    expect(asked).toEqual(['attendance.own.write']);
  });

  it('throws the unavailable error while the copy is missing', () => {
    expect(() => rolesHoldingOrThrow({ rolesHolding: () => null }, ATTENDANCE_STAFF_PERMISSION)).toThrow(
      AttendanceStaffUnavailableError,
    );
  });
});

describe('ActiveAttendanceStaffGuard', () => {
  const guardWith = (answer: boolean | Error) =>
    new ActiveAttendanceStaffGuard({
      isActiveStaff: () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)),
    });

  it('lets an active staff member through', async () => {
    await expect(guardWith(true).canActivate(contextFor('u-1'))).resolves.toBe(true);
  });

  it('answers 403 for a non-staff account', async () => {
    await expect(guardWith(false).canActivate(contextFor('u-1'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 503 while the permission copy is missing', async () => {
    await expect(
      guardWith(new AttendanceStaffUnavailableError()).canActivate(contextFor('u-1')),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
