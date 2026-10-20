import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, gt, sql } from 'drizzle-orm';
import {
  attendancePreferences,
  attendancePunches,
  attendanceSessions,
  attendanceWorksites,
  roles,
  userRoleAssignments,
  users,
  type UserServiceSchema,
  type UserServiceTx,
} from '../../../../database/drizzle/schema';
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  type AttendanceSession,
  type AttendanceSettings,
  type Worksite,
} from '@packages/domain-types/attendance';

@Injectable()
export class AttendanceRepository {
  constructor(@InjectDb() private readonly database: DbService<UserServiceSchema>) {}

  get db() {
    return this.database.db;
  }

  async withUserLock<T>(userId: string, work: (tx: UserServiceTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);

      return work(tx);
    });
  }

  async staff() {
    return this.db
      .selectDistinct({ userId: users.id, name: users.username })
      .from(users)
      .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
      .innerJoin(roles, eq(roles.roleId, userRoleAssignments.roleId))
      .where(
        and(
          inArray(roles.name, ['admin', 'master']),
          isNull(users.deletedAt),
          isNull(users.dormantAt),
          or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, new Date())),
        ),
      );
  }

  async findPunch(tx: UserServiceTx, userId: string, requestId: string) {
    const [row] = await tx
      .select()
      .from(attendancePunches)
      .where(and(eq(attendancePunches.userId, userId), eq(attendancePunches.requestId, requestId)))
      .limit(1);

    return row;
  }

  async findOpen(tx: UserServiceTx, userId: string) {
    const [row] = await tx
      .select()
      .from(attendanceSessions)
      .where(and(eq(attendanceSessions.userId, userId), isNull(attendanceSessions.checkOut)))
      .limit(1);

    return row;
  }

  async findDay(tx: UserServiceTx, userId: string, date: string) {
    const [row] = await tx
      .select()
      .from(attendanceSessions)
      .where(and(eq(attendanceSessions.userId, userId), eq(attendanceSessions.workDate, date)))
      .limit(1);

    return row;
  }

  async getSite(tx: UserServiceTx, id: string): Promise<Worksite | null> {
    const [site] = await tx
      .select()
      .from(attendanceWorksites)
      .where(and(eq(attendanceWorksites.id, id), eq(attendanceWorksites.active, true)))
      .limit(1);

    return site ? { ...site, latitude: Number(site.latitude), longitude: Number(site.longitude) } : null;
  }

  async createSession(tx: UserServiceTx, userId: string, workDate: string, now: Date) {
    const [session] = await tx.insert(attendanceSessions).values({ userId, workDate, checkIn: now }).returning();

    return session;
  }

  async finishSession(tx: UserServiceTx, id: string, now: Date) {
    const [session] = await tx
      .update(attendanceSessions)
      .set({ checkOut: now, version: sql`${attendanceSessions.version} + 1` })
      .where(and(eq(attendanceSessions.id, id), isNull(attendanceSessions.checkOut)))
      .returning();

    return session;
  }

  async appendPunch(tx: UserServiceTx, values: typeof attendancePunches.$inferInsert) {
    await tx.insert(attendancePunches).values(values);
  }

  async settings(userId: string): Promise<AttendanceSettings> {
    const [row] = await this.db.select().from(attendancePreferences).where(eq(attendancePreferences.userId, userId));

    return row?.settings ?? { ...DEFAULT_ATTENDANCE_SETTINGS };
  }

  async records(userId: string) {
    return this.db
      .select()
      .from(attendanceSessions)
      .where(eq(attendanceSessions.userId, userId))
      .orderBy(desc(attendanceSessions.checkIn))
      .limit(90);
  }
}

export function serializeSession(row: typeof attendanceSessions.$inferSelect): AttendanceSession {
  return { ...row, checkIn: row.checkIn.toISOString(), checkOut: row.checkOut?.toISOString() ?? null };
}
