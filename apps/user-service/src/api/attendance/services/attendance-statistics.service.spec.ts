import { BadRequestException } from '@nestjs/common';
import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AttendanceStatisticsController } from '../controllers/attendance-statistics.controller';
import { ActiveAttendanceStaffGuard } from '../guards/active-attendance-staff.guard';
import { monthlyRange, summarizeMonth } from './attendance-statistics.service';

describe('monthly attendance statistics', () => {
  it.each(['2026-00', '2026-13', '2026-2', 'no', '', '0000-01'])('rejects invalid month %s', (month) => {
    expect(() => monthlyRange(month)).toThrow();
  });

  it('rejects repeated month query parameters with a client error', () => {
    expect(() => monthlyRange(['2026-10'] as unknown as string)).toThrow(BadRequestException);
  });

  it('uses an exclusive next-month boundary including December and leap years', () => {
    expect(monthlyRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(monthlyRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-03-01' });
  });

  it('counts overnight work in its work date month and excludes incomplete intervals', () => {
    const result = summarizeMonth(
      '2026-10',
      [
        { userId: 'one', name: '하나' },
        { userId: 'two', name: '둘' },
      ],
      [
        {
          userId: 'one',
          workDate: '2026-10-01',
          checkIn: new Date('2026-10-01T09:00:00+09:00'),
          checkOut: new Date('2026-10-01T18:00:00+09:00'),
        },
        {
          userId: 'one',
          workDate: '2026-10-19',
          checkIn: new Date('2026-10-19T22:00:00+09:00'),
          checkOut: new Date('2026-10-20T02:00:00+09:00'),
        },
        { userId: 'one', workDate: '2026-10-18', checkIn: new Date('2026-10-18T09:00:00+09:00'), checkOut: null },
        { userId: 'two', workDate: '2026-10-20', checkIn: new Date('2026-10-20T09:00:00+09:00'), checkOut: null },
        { userId: 'other', workDate: '2026-10-01', checkIn: new Date('2026-10-01T09:00:00+09:00'), checkOut: null },
      ],
      '2026-10-20',
    );

    expect(result.people[0]).toMatchObject({
      userId: 'one',
      recordedDays: 3,
      completedDays: 2,
      recordedMinutes: 780,
      missingCheckoutDays: 1,
      ongoingDays: 0,
    });
    expect(result.people[1]).toMatchObject({
      userId: 'two',
      recordedDays: 1,
      recordedMinutes: 0,
      missingCheckoutDays: 0,
      ongoingDays: 1,
    });
    expect(result.totals).toEqual({
      employeeCount: 2,
      recordedDays: 4,
      completedDays: 2,
      recordedMinutes: 780,
      missingCheckoutDays: 1,
      ongoingDays: 1,
    });
  });

  it('includes staff with no records as zero and excludes records outside the requested month', () => {
    const result = summarizeMonth(
      '2026-10',
      [{ userId: 'one', name: '하나' }],
      [
        {
          userId: 'one',
          workDate: '2026-09-30',
          checkIn: new Date('2026-09-30T22:00:00+09:00'),
          checkOut: new Date('2026-10-01T02:00:00+09:00'),
        },
      ],
      '2026-10-20',
    );

    expect(result.people[0]).toMatchObject({ recordedDays: 0, recordedMinutes: 0 });
  });

  it('protects the monthly endpoint with the statistics permission and keeps the staff guard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AttendanceStatisticsController);

    expect(guards).toEqual([ActiveAttendanceStaffGuard]);
    // Metadata inspection reads the method reference without invoking it or losing its receiver.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AttendanceStatisticsController.prototype.monthly)).toEqual([
      'attendance.statistics.read',
    ]);
  });
});
