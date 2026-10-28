import type { Permission } from '@app/authorization';
import { DbService, InjectDb } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import type { UserServiceSchema, UserServiceTx } from 'apps/user-service/database/drizzle/schema';
import { fromZonedTime } from 'date-fns-tz';
import { IamAuditCreator, type IamAuditAction } from '../audit/iam-audit.creator';
import type { IamActor } from '../iam-actor';
import { SYSTEM_ROLE_NAME } from '../iam.constants';
import { IamEscalationError, IamLastMasterError, IamSelfChangeError, IamStaffCannotLeaveError } from '../iam.errors';
import { MyPermissionsReader } from '../my-permissions.reader';
import { RolePermissionsReader } from '../role-permissions.reader';
import { RoleRepository, type HeldAssignment } from '../roles/role.repository';
import { isCustomerRole, isSystemRole } from '../rules/iam-rules';

interface WantedAssignment {
  readonly roleId: string;
  readonly expiresAt: Date | null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 고객 역할(회원 등급)을 바꾸는 데 필요한 권한. */
const CUSTOMER_ROLE_CHANGE_PERMISSION: Permission = 'customer.profile.write';

/** `YYYY-MM-DD` → 그날 23:59:59.999(한국 시각). 오늘 이후가 아니면 400. */
export function endOfKoreanDay(date: string, now: Date = new Date()): Date {
  const [y, m, d] = date.split('-').map(Number);
  const valid = DATE_ONLY.test(date) && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (!valid) throw new BadRequestError('종료일은 YYYY-MM-DD 형식의 날짜여야 합니다.');
  const end = fromZonedTime(`${date}T23:59:59.999`, 'Asia/Seoul');
  if (end <= now) throw new BadRequestError('종료일은 오늘 이후여야 합니다.');
  return end;
}

const sameTime = (a: Date | null | undefined, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

@Injectable()
export class RoleAssignmentManager {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly roles: RoleRepository,
    private readonly audit: IamAuditCreator,
    private readonly myPermissions: MyPermissionsReader,
    private readonly snapshots: RolePermissionsReader,
  ) {}

  /** 고객 상세 창의 계약: 고객 역할까지 «이 목록으로» 교체한다. 남는 역할의 종료일은 그대로 둔다. */
  async replaceAll(actor: IamActor, userId: string, roleIds: readonly string[]): Promise<void> {
    await this.dbService.run(async (tx) => {
      const held = await this.roles.assignmentsOf(userId, tx);
      const kept = new Map(held.map((h) => [h.roleId, h.expiresAt]));
      const wanted = [...new Set(roleIds)].map((roleId) => ({ roleId, expiresAt: kept.get(roleId) ?? null }));
      await this.apply(tx, actor, userId, held, wanted, 'user.roles.replace');
    });
  }

  /** 직원 역할 편집: 직원 역할만 교체한다(고객 역할은 그대로). */
  async replaceStaff(
    actor: IamActor,
    userId: string,
    assignments: readonly { roleId: string; expiresAt: string | null }[],
  ): Promise<void> {
    const now = new Date();
    // 같은 역할이 두 번 오면 뒤의 것 하나로 — 부여 행은 사람·역할마다 하나다.
    const latest = new Map(assignments.map((a) => [a.roleId, a.expiresAt]));
    const staff = [...latest].map(([roleId, expiresAt]) => ({
      roleId,
      expiresAt: expiresAt === null ? null : endOfKoreanDay(expiresAt, now),
    }));
    await this.dbService.run(async (tx) => {
      const asked = await this.roles.findRolesByIds(
        staff.map((s) => s.roleId),
        tx,
      );
      if (asked.some((r) => isCustomerRole(r.name))) {
        throw new BadRequestError('고객 역할은 직원 역할 편집에서 줄 수 없습니다.');
      }
      const held = await this.roles.assignmentsOf(userId, tx);
      const named = new Set(staff.map((s) => s.roleId));
      // 고객 역할과, 요청이 말하지 않은 «기간이 지난» 직원 부여는 그대로 둔다 — 화면은 만료 기록을 꺼진 채로
      // 보여 줄 뿐이라, 다른 역할만 고친 저장이 그 기록까지 지우면 안 된다. 지우는 건 회수(removeMember)다.
      const now = Date.now();
      const untouched = held
        .filter(
          (h) =>
            isCustomerRole(h.name) || (!named.has(h.roleId) && h.expiresAt !== null && h.expiresAt.getTime() <= now),
        )
        .map((h) => ({ roleId: h.roleId, expiresAt: h.expiresAt }));
      await this.apply(tx, actor, userId, held, [...untouched, ...staff], 'user.roles.replace');
    });
  }

  /** 여러 사람에게 역할 하나를 더한다(이미 있으면 종료일만 바꾼다). */
  async addMembers(
    actor: IamActor,
    roleId: string,
    userIds: readonly string[],
    expiresAt: string | null,
  ): Promise<void> {
    const end = expiresAt === null ? null : endOfKoreanDay(expiresAt);
    await this.dbService.run(async (tx) => {
      for (const userId of [...new Set(userIds)]) {
        const held = await this.roles.assignmentsOf(userId, tx);
        const others = held
          .filter((h) => h.roleId !== roleId)
          .map((h) => ({ roleId: h.roleId, expiresAt: h.expiresAt }));
        await this.apply(tx, actor, userId, held, [...others, { roleId, expiresAt: end }], 'role.members.add');
      }
    });
  }

  async removeMember(actor: IamActor, roleId: string, userId: string): Promise<void> {
    await this.dbService.run(async (tx) => {
      const held = await this.roles.assignmentsOf(userId, tx);
      const rest = held.filter((h) => h.roleId !== roleId).map((h) => ({ roleId: h.roleId, expiresAt: h.expiresAt }));
      await this.apply(tx, actor, userId, held, rest, 'role.member.remove');
    });
  }

  /**
   * 탈퇴 전 확인 — 기간 없이 시스템 역할을 가진 마지막 사람은 떠날 수 없다. 그 역할 행을 잠그고 세므로 탈퇴 트랜잭션
   * 안에서 부른다(`tx`) — 잠금이 탈퇴가 끝날 때까지 남아 동시 탈퇴·회수가 차례로 판정된다.
   */
  async assertCanLeave(userId: string, tx?: UserServiceTx): Promise<void> {
    await this.dbService.run(async (tx) => {
      const held = await this.roles.assignmentsOf(userId, tx);
      if (!held.some((h) => isSystemRole(h.name) && h.expiresAt === null)) return;
      await this.assertSystemRoleSurvives(tx, { id: userId, canSignIn: false }, new Map());
    }, tx);
  }

  /** 탈퇴 전 확인 — 지금 직원 역할이 유효한 계정은 스스로 떠날 수 없다. 역할 회수가 먼저다. */
  async assertNotStaff(userId: string, tx?: UserServiceTx): Promise<void> {
    await this.dbService.run(async (tx) => {
      if (await this.roles.hasLiveStaffRole(userId, tx)) throw new IamStaffCannotLeaveError();
    }, tx);
  }

  /** 관리자 계정을 만들 때의 첫 역할 — 같은 규칙, 같은 트랜잭션. */
  assignOnCreate(tx: UserServiceTx, actor: IamActor, userId: string, roleId: string): Promise<void> {
    return this.apply(tx, actor, userId, [], [{ roleId, expiresAt: null }], 'admin_user.create');
  }

  private async apply(
    tx: UserServiceTx,
    actor: IamActor,
    userId: string,
    held: readonly HeldAssignment[],
    wanted: readonly WantedAssignment[],
    action: IamAuditAction,
  ): Promise<void> {
    const user = await this.roles.findUser(userId, tx);
    if (!user) throw new NotFoundError('사용자를 찾을 수 없습니다.');
    if (user.id === actor.userId) throw new IamSelfChangeError();

    const wantedIds = [...new Set(wanted.map((w) => w.roleId))];
    const found = await this.roles.findRolesByIds(wantedIds, tx);
    if (found.length !== wantedIds.length) throw new BadRequestError('없는 역할이 포함되어 있습니다.');
    const nameOf = new Map<string, string>([
      ...held.map((h): [string, string] => [h.roleId, h.name]),
      ...found.map((r): [string, string] => [r.roleId, r.name]),
    ]);

    const before = new Map(held.map((h) => [h.roleId, h.expiresAt]));
    const after = new Map(wanted.map((w) => [w.roleId, w.expiresAt]));
    const added = wanted.filter((w) => !before.has(w.roleId));
    const removed = held.filter((h) => !after.has(h.roleId)).map((h) => h.roleId);
    const retimed = wanted.filter((w) => before.has(w.roleId) && !sameTime(before.get(w.roleId), w.expiresAt));
    const touched = [...added.map((a) => a.roleId), ...removed, ...retimed.map((r) => r.roleId)];
    if (touched.length === 0) return;

    await this.assertCanGrant(
      tx,
      actor,
      touched.map((id) => nameOf.get(id) ?? ''),
    );
    if (touched.some((id) => isSystemRole(nameOf.get(id) ?? ''))) {
      await this.assertSystemRoleSurvives(tx, user, after);
    }

    await this.roles.deleteAssignments(userId, removed, tx);
    await this.roles.insertAssignments(userId, added, tx);
    for (const r of retimed) await this.roles.updateExpiry(userId, r.roleId, r.expiresAt, tx);

    const view = (rows: readonly WantedAssignment[]) =>
      rows.map((r) => ({ roleId: r.roleId, name: nameOf.get(r.roleId) ?? '', expiresAt: r.expiresAt }));
    await this.audit.record(tx, actor, {
      action,
      targetType: 'user',
      targetId: userId,
      targetLabel: user.loginId,
      before: view(held.map((h) => ({ roleId: h.roleId, expiresAt: h.expiresAt }))),
      after: view(wanted),
    });
  }

  /**
   * 바뀌는 역할의 권한을 내가 모두 가져야 한다 — 주는 것도, 회수하는 것도(줄 수 없는 역할은 회수도 못 한다:
   * 낮은 권한자가 상위 관리자를 강등하지 못하게 하는 우리 정책).
   */
  private async assertCanGrant(tx: UserServiceTx, actor: IamActor, roleNames: readonly string[]): Promise<void> {
    const [snapshot, mine] = await Promise.all([
      this.snapshots.snapshot(),
      this.actorRoles(tx, actor).then((names) => this.myPermissions.forRoles(names)),
    ]);
    const held = new Set(mine.permissions);
    // 고객 역할(회원 등급)을 바꾸는 것은 고객 정보를 고치는 일이다 — 고객 정보를 고칠 수 있는 사람만 바꾼다.
    if (roleNames.some(isCustomerRole) && !held.has(CUSTOMER_ROLE_CHANGE_PERMISSION)) {
      throw new IamEscalationError(
        `고객 역할을 주거나 회수하려면 '${CUSTOMER_ROLE_CHANGE_PERMISSION}' 권한이 필요합니다.`,
      );
    }
    for (const name of new Set(roleNames)) {
      const grants = Object.hasOwn(snapshot.roles, name) ? snapshot.roles[name] : [];
      const beyond = grants.filter((key) => !held.has(key));
      if (beyond.length > 0) {
        throw new IamEscalationError(
          `'${name}' 역할을 주거나 회수할 수 없습니다 — 내가 가진 권한만 줄 수 있습니다: ${beyond.join(', ')}`,
        );
      }
    }
  }

  /** 시스템 역할을 기간 없이 가진 사람이 남는지 — 동시에 서로 회수해도 0명이 되지 않게 그 역할 행을 잠근 뒤 센다. */
  private async assertSystemRoleSurvives(
    tx: UserServiceTx,
    user: { id: string; canSignIn: boolean },
    after: ReadonlyMap<string, Date | null>,
  ): Promise<void> {
    const system = await this.roles.findRoleByName(SYSTEM_ROLE_NAME, tx);
    if (!system) return;
    await this.roles.lockRole(system.roleId, tx);
    const others = await this.roles.countPermanentHolders(system.roleId, tx, user.id);
    const remains = user.canSignIn && after.has(system.roleId) && after.get(system.roleId) === null;
    if (others + (remains ? 1 : 0) < 1) throw new IamLastMasterError();
  }

  /** 토큰의 역할 중 지금도 유효한 것만 — 토큰 발급 뒤 기간이 끝나거나 회수된 역할로 남에게 권한을 주지 못하게. */
  private async actorRoles(tx: UserServiceTx, actor: IamActor): Promise<string[]> {
    const active = new Set(await this.roles.activeRoleNamesOf(actor.userId, tx));
    return actor.roles.filter((name) => active.has(name));
  }
}
