import { PermissionCache, type Permission } from '@app/authorization';
import { DbService, InjectDb } from '@app/db';
import { Inject, Injectable } from '@nestjs/common';
import { ATTENDANCE_STAFF_PERMISSION, rolesHoldingOrThrow, type RoleHolderLookup } from '../attendance-staff';
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
  constructor(
    @InjectDb() private readonly database: DbService<UserServiceSchema>,
    @Inject(PermissionCache) private readonly roleHolders: RoleHolderLookup,
  ) {}

  get db() {
    return this.database.db;
  }

  async withUserLock<T>(userId: string, work: (tx: UserServiceTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);

      return work(tx);
    });
  }

  /** 역할별 권한 사본을 받았는가. 받기 전에는 직원·알림 대상을 판정할 수 없다. */
  permissionsLoaded(): boolean {
    return this.roleHolders.rolesHolding(ATTENDANCE_STAFF_PERMISSION) !== null;
  }

  /** 근태 «직원» — 근태 권한을 가진 역할의 보유자(삭제·휴면 제외, 기간이 끝나지 않은 부여). */
  async staff() {
    return this.holdersOf(ATTENDANCE_STAFF_PERMISSION);
  }

  /** 이 권한을 가진 역할의 보유자. 권한 사본이 없으면 `AttendanceStaffUnavailableError`. */
  async holdersOf(permission: Permission): Promise<{ userId: string; name: string }[]> {
    const roleNames = rolesHoldingOrThrow(this.roleHolders, permission);

    if (roleNames.length === 0) {
      return [];
    }

    return this.db
      .selectDistinct({ userId: users.id, name: users.username })
      .from(users)
      .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
      .innerJoin(roles, eq(roles.roleId, userRoleAssignments.roleId))
      .where(
        and(
          inArray(roles.name, [...roleNames]),
          isNull(users.deletedAt),
          isNull(users.dormantAt),
          or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, new Date())),
        ),
      );
  }

  /** 이 사람이 지금 근태 직원인가 — 그 사람의 부여만 읽는다. */
  async isActiveStaff(userId: string | undefined): Promise<boolean> {
    if (!userId) {
      return false;
    }

    const roleNames = rolesHoldingOrThrow(this.roleHolders, ATTENDANCE_STAFF_PERMISSION);

    if (roleNames.length === 0) {
      return false;
    }

    const [row] = await this.db
      .select({ userId: users.id })
      .from(users)
      .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
      .innerJoin(roles, eq(roles.roleId, userRoleAssignments.roleId))
      .where(
        and(
          eq(users.id, userId),
          inArray(roles.name, [...roleNames]),
          isNull(users.deletedAt),
          isNull(users.dormantAt),
          or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, new Date())),
        ),
      )
      .limit(1);

    return row !== undefined;
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
