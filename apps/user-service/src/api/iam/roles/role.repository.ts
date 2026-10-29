import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import {
  iamPermissions,
  iamRolePermissions,
  roles,
  userRoleAssignments,
  users,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { liveStaffAssignment } from '../iam.constants';
import { and, count, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';

export type RoleRow = typeof roles.$inferSelect;

export interface HeldAssignment {
  readonly roleId: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly assignedAt: Date;
  readonly expiresAt: Date | null;
}

// 토큰 발급(`getUserRoleNames`)과 같은 기준 — 지금 시각을 앱에서 넘긴다.
const activeAssignment = () => or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, new Date()));

/** 역할과 사람↔역할 부여. 권한 목록 자체는 IamRepository 가 맡는다. */
@Injectable()
export class RoleRepository {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  private client(tx?: UserServiceTx) {
    return tx ?? this.dbService.db;
  }

  // ── 역할

  listRoles() {
    return this.dbService.db.select().from(roles).orderBy(roles.createdAt, roles.name);
  }

  async findRole(roleId: string, tx?: UserServiceTx): Promise<RoleRow | null> {
    const [row] = await this.client(tx).select().from(roles).where(eq(roles.roleId, roleId));
    return row ?? null;
  }

  findRolesByIds(roleIds: readonly string[], tx?: UserServiceTx): Promise<RoleRow[]> {
    if (roleIds.length === 0) return Promise.resolve([]);
    return this.client(tx)
      .select()
      .from(roles)
      .where(inArray(roles.roleId, [...roleIds]));
  }

  /** 지금 유효한 직원 역할을 하나라도 가졌는가. */
  async hasLiveStaffRole(userId: string, tx: UserServiceTx): Promise<boolean> {
    const [row] = await tx
      .select({ roleId: userRoleAssignments.roleId })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(roles.roleId, userRoleAssignments.roleId))
      .where(and(eq(userRoleAssignments.userId, userId), liveStaffAssignment()))
      .limit(1);
    return row !== undefined;
  }

  async findRoleByName(name: string, tx: UserServiceTx): Promise<RoleRow | null> {
    const [row] = await tx.select().from(roles).where(eq(roles.name, name));
    return row ?? null;
  }

  /** 같은 역할을 고치는 요청끼리 줄을 세운다(버전 비교와 마지막 시스템 역할 보유자 계산의 전제). */
  async lockRole(roleId: string, tx: UserServiceTx): Promise<RoleRow | null> {
    const [row] = await tx.select().from(roles).where(eq(roles.roleId, roleId)).for('update');
    return row ?? null;
  }

  /** 같은 이름이 먼저 커밋됐으면 null — 확인과 삽입 사이에 끼어든 요청도 충돌로 돌려준다. */
  async insertRole(
    row: { name: string; displayName: string; description: string | null; landingPath: string | null },
    tx: UserServiceTx,
  ): Promise<RoleRow | null> {
    const [created] = await tx.insert(roles).values(row).onConflictDoNothing({ target: roles.name }).returning();
    return created ?? null;
  }

  async updateRole(
    roleId: string,
    patch: { displayName?: string; description?: string | null; landingPath?: string | null },
    tx: UserServiceTx,
  ): Promise<void> {
    await tx
      .update(roles)
      .set({ ...patch, version: sql`${roles.version} + 1`, updatedAt: new Date() })
      .where(eq(roles.roleId, roleId));
  }

  async bumpVersion(roleId: string, tx: UserServiceTx): Promise<void> {
    await tx
      .update(roles)
      .set({ version: sql`${roles.version} + 1`, updatedAt: new Date() })
      .where(eq(roles.roleId, roleId));
  }

  async deleteRole(roleId: string, tx: UserServiceTx): Promise<void> {
    await tx.delete(roles).where(eq(roles.roleId, roleId));
  }

  // ── 역할의 권한

  async grantsOf(roleId: string, tx?: UserServiceTx): Promise<string[]> {
    const rows = await this.client(tx)
      .select({ key: iamRolePermissions.permissionKey })
      .from(iamRolePermissions)
      .where(eq(iamRolePermissions.roleId, roleId));
    return rows.map((r) => r.key).sort();
  }

  async replaceGrants(
    roleId: string,
    added: readonly string[],
    removed: readonly string[],
    actorId: string,
    tx: UserServiceTx,
  ): Promise<void> {
    if (removed.length > 0) {
      await tx
        .delete(iamRolePermissions)
        .where(and(eq(iamRolePermissions.roleId, roleId), inArray(iamRolePermissions.permissionKey, [...removed])));
    }
    if (added.length > 0) {
      await tx
        .insert(iamRolePermissions)
        .values(added.map((permissionKey) => ({ roleId, permissionKey, grantedBy: actorId })))
        .onConflictDoNothing();
    }
  }

  async grantCounts(): Promise<Map<string, { total: number; dangerous: number }>> {
    const rows = await this.dbService.db
      .select({
        roleId: iamRolePermissions.roleId,
        total: count(),
        dangerous: sql<number>`count(*) filter (where ${iamPermissions.dangerous})`,
      })
      .from(iamRolePermissions)
      .innerJoin(
        iamPermissions,
        and(
          eq(iamPermissions.key, iamRolePermissions.permissionKey),
          isNull(iamPermissions.deprecatedAt),
          eq(iamPermissions.systemOnly, false),
        ),
      )
      .groupBy(iamRolePermissions.roleId);
    return new Map(rows.map((r) => [r.roleId, { total: Number(r.total), dangerous: Number(r.dangerous) }]));
  }

  // ── 사람↔역할 부여

  /** 기간이 지난 행을 포함한 «부여 행» 수 — 역할을 지우면 이 기록도 함께 사라진다. */
  async countAssignments(roleId: string, tx: UserServiceTx): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(userRoleAssignments)
      .where(eq(userRoleAssignments.roleId, roleId));
    return Number(row?.n ?? 0);
  }

  async activeMemberCounts(): Promise<Map<string, number>> {
    const rows = await this.dbService.db
      .select({ roleId: userRoleAssignments.roleId, n: count() })
      .from(userRoleAssignments)
      .where(activeAssignment())
      .groupBy(userRoleAssignments.roleId);
    return new Map(rows.map((r) => [r.roleId, Number(r.n)]));
  }

  async findUser(
    userId: string,
    tx?: UserServiceTx,
  ): Promise<{ id: string; loginId: string; username: string; canSignIn: boolean } | null> {
    const [row] = await this.client(tx)
      .select({
        id: users.id,
        loginId: users.loginId,
        username: users.username,
        deletedAt: users.deletedAt,
        dormantAt: users.dormantAt,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!row) return null;
    const { deletedAt, dormantAt, ...user } = row;
    return { ...user, canSignIn: deletedAt === null && dormantAt === null };
  }

  /** 지금 유효한 부여의 역할 이름(토큰 발급과 같은 기준). */
  async activeRoleNamesOf(userId: string, tx?: UserServiceTx): Promise<string[]> {
    const rows = await this.client(tx)
      .select({ name: roles.name })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(roles.roleId, userRoleAssignments.roleId))
      .where(and(eq(userRoleAssignments.userId, userId), activeAssignment()));
    return rows.map((r) => r.name);
  }

  /** 기간이 지난 부여까지 돌려준다 — 화면은 «만료됨»으로 보이고, 교체 계산은 그대로 비교한다. */
  assignmentsOf(userId: string, tx?: UserServiceTx): Promise<HeldAssignment[]> {
    return (
      this.client(tx)
        .select({
          roleId: roles.roleId,
          name: roles.name,
          displayName: roles.displayName,
          assignedAt: userRoleAssignments.assignedAt,
          expiresAt: userRoleAssignments.expiresAt,
        })
        .from(userRoleAssignments)
        .innerJoin(roles, eq(roles.roleId, userRoleAssignments.roleId))
        // 정렬을 걸지 않는다 — 옛 «사람의 역할» 응답과 같은 순서(고객 상세 창의 배지 순서)를 지킨다.
        .where(eq(userRoleAssignments.userId, userId))
    );
  }

  async insertAssignments(
    userId: string,
    rows: readonly { roleId: string; expiresAt: Date | null }[],
    tx: UserServiceTx,
  ): Promise<void> {
    if (rows.length === 0) return;
    await tx
      .insert(userRoleAssignments)
      .values(rows.map((r) => ({ userId, roleId: r.roleId, expiresAt: r.expiresAt })));
  }

  async deleteAssignments(userId: string, roleIds: readonly string[], tx: UserServiceTx): Promise<void> {
    if (roleIds.length === 0) return;
    await tx
      .delete(userRoleAssignments)
      .where(and(eq(userRoleAssignments.userId, userId), inArray(userRoleAssignments.roleId, [...roleIds])));
  }

  async updateExpiry(userId: string, roleId: string, expiresAt: Date | null, tx: UserServiceTx): Promise<void> {
    await tx
      .update(userRoleAssignments)
      .set({ expiresAt, updatedAt: new Date() })
      .where(and(eq(userRoleAssignments.userId, userId), eq(userRoleAssignments.roleId, roleId)));
  }

  /** `exceptUserId` 를 뺀, 기간 없이 지금 로그인할 수 있는 보유자 수(탈퇴·휴면 제외). 잠근 뒤에 부른다. */
  async countPermanentHolders(roleId: string, tx: UserServiceTx, exceptUserId: string): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(userRoleAssignments)
      .innerJoin(users, eq(users.id, userRoleAssignments.userId))
      .where(
        and(
          eq(userRoleAssignments.roleId, roleId),
          ne(userRoleAssignments.userId, exceptUserId),
          isNull(userRoleAssignments.expiresAt),
          isNull(users.deletedAt),
          isNull(users.dormantAt),
        ),
      );
    return Number(row?.n ?? 0);
  }

  async membersOf(roleId: string) {
    const rows = await this.dbService.db
      .select({
        userId: users.id,
        loginId: users.loginId,
        username: users.username,
        assignedAt: userRoleAssignments.assignedAt,
        expiresAt: userRoleAssignments.expiresAt,
        deletedAt: users.deletedAt,
        dormantAt: users.dormantAt,
      })
      .from(userRoleAssignments)
      .innerJoin(users, eq(users.id, userRoleAssignments.userId))
      .where(eq(userRoleAssignments.roleId, roleId))
      .orderBy(users.loginId);
    const now = Date.now();
    return rows.map(({ deletedAt, dormantAt, ...r }) => ({
      ...r,
      expired: r.expiresAt !== null && r.expiresAt.getTime() <= now,
      canSignIn: deletedAt === null && dormantAt === null,
    }));
  }
}
