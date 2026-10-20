import { BadRequestException, Injectable } from '@nestjs/common';
import { and, gte, lt } from 'drizzle-orm';
import { seoulDate, type MonthlyAttendanceStatistics } from '@packages/domain-types/attendance';
import { attendanceSessions } from '../../../../database/drizzle/schema';
import { AttendanceRepository } from '../repositories/attendance.repository';

export function monthlyRange(month: string) {
  if (
    typeof month !== 'string' ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    Number(month.slice(0, 4)) < 1900 ||
    Number(month.slice(0, 4)) > 9998
  ) {
    throw new BadRequestException('조회할 월을 YYYY-MM 형식으로 선택해 주세요.');
  }

  const [year, number] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10);

  return { from: `${month}-01`, to: next };
}

type StatisticsSession = {
  userId: string;
  workDate: string;
  checkIn: Date;
  checkOut: Date | null;
};

export function summarizeMonth(
  month: string,
  staff: { userId: string; name: string }[],
  sessions: StatisticsSession[],
  today: string,
): MonthlyAttendanceStatistics {
  const { from, to } = monthlyRange(month);
  const people = staff.map((person) => ({
    ...person,
    recordedDays: 0,
    completedDays: 0,
    recordedMinutes: 0,
    missingCheckoutDays: 0,
    ongoingDays: 0,
  }));
  const byUser = new Map(people.map((person) => [person.userId, person]));

  for (const session of sessions) {
    const person = byUser.get(session.userId);

    if (!person || session.workDate < from || session.workDate >= to) {
      continue;
    }

    person.recordedDays += 1;

    if (session.checkOut) {
      person.completedDays += 1;
      person.recordedMinutes += Math.max(
        0,
        Math.floor((session.checkOut.getTime() - session.checkIn.getTime()) / 60000),
      );
    } else if (session.workDate < today) {
      person.missingCheckoutDays += 1;
    } else {
      person.ongoingDays += 1;
    }
  }

  const totals = {
    employeeCount: people.length,
    recordedDays: 0,
    completedDays: 0,
    recordedMinutes: 0,
    missingCheckoutDays: 0,
    ongoingDays: 0,
  };

  for (const person of people) {
    totals.recordedDays += person.recordedDays;
    totals.completedDays += person.completedDays;
    totals.recordedMinutes += person.recordedMinutes;
    totals.missingCheckoutDays += person.missingCheckoutDays;
    totals.ongoingDays += person.ongoingDays;
  }

  return { month, people, totals };
}

@Injectable()
export class AttendanceStatisticsService {
  constructor(private readonly repo: AttendanceRepository) {}

  async monthly(month: string): Promise<MonthlyAttendanceStatistics> {
    const { from, to } = monthlyRange(month);
    const [staff, sessions] = await Promise.all([
      this.repo.staff(),
      this.repo.db
        .select({
          userId: attendanceSessions.userId,
          workDate: attendanceSessions.workDate,
          checkIn: attendanceSessions.checkIn,
          checkOut: attendanceSessions.checkOut,
        })
        .from(attendanceSessions)
        .where(and(gte(attendanceSessions.workDate, from), lt(attendanceSessions.workDate, to))),
    ]);

    return summarizeMonth(month, staff, sessions, seoulDate(new Date()));
  }
}
