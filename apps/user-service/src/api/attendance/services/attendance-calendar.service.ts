import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, between, desc, eq, isNull, lt, or } from 'drizzle-orm';
import {
  isWorkDate,
  recommendPlannedClock,
  seoulDate,
  validatePlannedTimes,
  type LeaveInput,
  type StaffAttendance,
} from '@packages/domain-types/attendance';
import { attendanceAudit, attendanceLeaves, attendanceSessions, users } from '../../../../database/drizzle/schema';
import { AttendanceRepository } from '../repositories/attendance.repository';

export function validateLeaveBatch(batch: LeaveInput[]): void {
  if (!Array.isArray(batch) || !batch.length || batch.length > 366) {
    throw new BadRequestException('등록할 날짜를 1~366개 선택해 주세요.');
  }

  const dates = new Set<string>();

  for (const item of batch) {
    if (!item || !isWorkDate(item.date) || !['full', 'am', 'pm'].includes(item.type) || dates.has(item.date)) {
      throw new BadRequestException('날짜와 휴가 종류를 확인해 주세요. 같은 날짜는 중복 등록할 수 없어요.');
    }

    dates.add(item.date);

    if (item.type !== 'full') {
      const message = validatePlannedTimes(item.start ?? '', item.end ?? '');

      if (message) {
        throw new BadRequestException(message);
      }
    }
  }
}

export function assertLeaveOwner(owner: string, actor: string): void {
  if (owner !== actor) {
    throw new ForbiddenException('본인 일정만 수정할 수 있어요.');
  }
}

@Injectable()
export class AttendanceCalendarService {
  constructor(private readonly repo: AttendanceRepository) {}

  async recommendations(userId: string) {
    const history = await this.repo.db
      .select()
      .from(attendanceLeaves)
      .where(
        and(
          eq(attendanceLeaves.userId, userId),
          isNull(attendanceLeaves.deletedAt),
          lt(attendanceLeaves.date, seoulDate(new Date())),
        ),
      )
      .orderBy(desc(attendanceLeaves.date))
      .limit(60);

    const settings = await this.repo.settings(userId);

    const result = {} as Record<'am' | 'pm', { start: string; end: string } | null>;

    for (const type of ['am', 'pm'] as const) {
      const rows = history.filter((item) => item.type === type);
      const start = recommendPlannedClock(rows.map((item) => item.start ?? ''));
      const end = type === 'am' ? settings.normalEnd : recommendPlannedClock(rows.map((item) => item.end ?? ''));

      result[type] = start && end ? { start, end } : null;
    }

    return result;
  }

  async list(from: string, to: string) {
    if (
      !isWorkDate(from) ||
      !isWorkDate(to) ||
      from > to ||
      new Date(to).getTime() - new Date(from).getTime() > 366 * 86400000
    ) {
      throw new BadRequestException('조회 기간은 최대 1년으로 선택해 주세요.');
    }

    return this.repo.db
      .select({
        id: attendanceLeaves.id,
        userId: attendanceLeaves.userId,
        name: users.username,
        date: attendanceLeaves.date,
        type: attendanceLeaves.type,
        start: attendanceLeaves.start,
        end: attendanceLeaves.end,
      })
      .from(attendanceLeaves)
      .innerJoin(users, eq(users.id, attendanceLeaves.userId))
      .where(and(between(attendanceLeaves.date, from, to), isNull(attendanceLeaves.deletedAt), isNull(users.deletedAt)))
      .orderBy(attendanceLeaves.date, users.username);
  }

  async save(userId: string, items: LeaveInput[]) {
    validateLeaveBatch(items);

    return this.repo.withUserLock(userId, async (tx) => {
      const existing = await tx
        .select()
        .from(attendanceLeaves)
        .where(and(eq(attendanceLeaves.userId, userId), isNull(attendanceLeaves.deletedAt)));

      const byDate = new Map(existing.map((row) => [row.date, row]));
      const result: (typeof attendanceLeaves.$inferSelect)[] = [];

      for (const item of items) {
        const saved = byDate.get(item.date);

        if (saved) {
          result.push(saved);

          continue;
        }

        const [row] = await tx
          .insert(attendanceLeaves)
          .values({
            userId,
            date: item.date,
            type: item.type,
            start: item.type === 'full' ? null : item.start,
            end: item.type === 'full' ? null : item.end,
          })
          .returning();

        await tx.insert(attendanceAudit).values({
          actorId: userId,
          subjectId: userId,
          kind: 'leave.created',
          entityId: row.id,
          after: row,
        });

        result.push(row);
      }

      return result;
    });
  }

  async remove(userId: string, id: string) {
    return this.repo.withUserLock(userId, async (tx) => {
      const [row] = await tx
        .select()
        .from(attendanceLeaves)
        .where(and(eq(attendanceLeaves.id, id), isNull(attendanceLeaves.deletedAt)));

      if (!row) {
        throw new NotFoundException('일정을 찾을 수 없어요.');
      }

      assertLeaveOwner(row.userId, userId);

      await tx.update(attendanceLeaves).set({ deletedAt: new Date() }).where(eq(attendanceLeaves.id, id));

      await tx
        .insert(attendanceAudit)
        .values({ actorId: userId, subjectId: userId, kind: 'leave.deleted', entityId: id, before: row });

      return { success: true };
    });
  }

  async update(userId: string, id: string, item: LeaveInput) {
    validateLeaveBatch([item]);

    return this.repo.withUserLock(userId, async (tx) => {
      const [row] = await tx
        .select()
        .from(attendanceLeaves)
        .where(and(eq(attendanceLeaves.id, id), isNull(attendanceLeaves.deletedAt)));

      if (!row) {
        throw new NotFoundException('일정을 찾을 수 없어요.');
      }

      assertLeaveOwner(row.userId, userId);

      if (row.date !== item.date) {
        throw new BadRequestException('날짜를 바꾸려면 기존 일정을 삭제한 뒤 등록해 주세요.');
      }

      const [changed] = await tx
        .update(attendanceLeaves)
        .set({
          type: item.type,
          start: item.type === 'full' ? null : item.start,
          end: item.type === 'full' ? null : item.end,
        })
        .where(eq(attendanceLeaves.id, id))
        .returning();

      await tx.insert(attendanceAudit).values({
        actorId: userId,
        subjectId: userId,
        kind: 'leave.updated',
        entityId: id,
        before: row,
        after: changed,
      });

      return changed;
    });
  }

  async overview(now = new Date()): Promise<{ date: string; updatedAt: string; people: StaffAttendance[] }> {
    const date = seoulDate(now);

    const [staff, sessions, leaves] = await Promise.all([
      this.repo.staff(),
      this.repo.db
        .select()
        .from(attendanceSessions)
        .where(or(eq(attendanceSessions.workDate, date), isNull(attendanceSessions.checkOut))),
      this.list(date, date),
    ]);

    const people = staff.map(({ userId, name }): StaffAttendance => {
      const owned = sessions.filter((session) => session.userId === userId);
      const session = owned.find((item) => !item.checkOut) ?? owned.find((item) => item.workDate === date);
      const leave = leaves.find((item) => item.userId === userId);

      return {
        userId,
        name,
        status: session ? (session.checkOut ? 'done' : 'working') : 'before',
        leave: leave ? { type: leave.type, start: leave.start, end: leave.end } : null,
      };
    });

    return { date, updatedAt: now.toISOString(), people };
  }
}
