import { DbService, InjectDb } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import type { UserServiceSchema, UserServiceTx } from 'apps/user-service/database/drizzle/schema';
import { fromZonedTime } from 'date-fns-tz';
import { IamAuditCreator, type IamAuditAction } from '../audit/iam-audit.creator';
import { GrantAuthority } from './grant-authority';
import type { IamActor } from '../iam-actor';
import {
  IamGrantedElsewhereError,
  IamNotAccountTenantError,
  IamSelfChangeError,
  IamStaffCannotLeaveError,
} from '../iam.errors';
import { RoleRepository, type HeldAssignment } from '../roles/role.repository';
import { isCustomerRole } from '../rules/iam-rules';
import { PlatformOperatorManager } from '../tenancy/platform-operator.manager';
import { TenancyRepository } from '../tenancy/tenancy.repository';

interface WantedAssignment {
  readonly roleId: string;
  readonly expiresAt: Date | null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` → 그날 23:59:59.999(한국 시각). 오늘 이후가 아니면 400. */
export function endOfKoreanDay(date: string, now: Date = new Date()): Date {
  const [y, m, d] = date.split('-').map(Number);
  const valid = DATE_ONLY.test(date) && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (!valid) throw new BadRequestError('종료일은 YYYY-MM-DD 형식의 날짜여야 합니다.');
  const end = fromZonedTime(`${date}T23:59:59.999`, 'Asia/Seoul');
  if (end <= now) throw new BadRequestError('종료일은 오늘 이후여야 합니다.');
  return end;
}

/** 요청자가 일하는 테넌트와, 대상의 부여 중 그 테넌트 것(held)·다른 테넌트에 있는 역할(elsewhere). */
interface TenantScope {
  readonly tenantId: string;
  readonly held: readonly HeldAssignment[];
  readonly elsewhere: ReadonlySet<string>;
}

const sameTime = (a: Date | null | undefined, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

@Injectable()
export class RoleAssignmentManager {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly roles: RoleRepository,
    private readonly audit: IamAuditCreator,
    private readonly authority: GrantAuthority,
    private readonly tenancy: TenancyRepository,
    private readonly operators: PlatformOperatorManager,
  ) {}

  /**
   * 요청자가 일하는 테넌트와, 대상의 부여를 그 테넌트 것과 나머지로 나눈 것. 교체·추가·회수는 그 테넌트 안에서만 계산한다 —
   * 다른 테넌트의 부여는 보지도 지우지도 않는다. 일하는 테넌트는 언제나 요청자 테넌트다(운영자도, ADR-0056).
   */
  private async scope(tx: UserServiceTx, actor: IamActor, userId: string): Promise<TenantScope> {
    return this.scopeIn(tx, userId, await this.operators.workingTenant(actor, tx));
  }

  private async scopeIn(tx: UserServiceTx, userId: string, tenantId: string): Promise<TenantScope> {
    const all = await this.roles.assignmentsOf(userId, tx);
    return {
      tenantId,
      held: all.filter((h) => h.tenantId === tenantId),
      elsewhere: new Set(all.filter((h) => h.tenantId !== tenantId).map((h) => h.roleId)),
    };
  }

  /** 고객 상세 창의 계약: 고객 역할까지 «이 목록으로» 교체한다. 남는 역할의 종료일은 그대로 둔다. */
  async replaceAll(actor: IamActor, userId: string, roleIds: readonly string[]): Promise<void> {
    await this.dbService.run(async (tx) => {
      const scope = await this.scope(tx, actor, userId);
      const kept = new Map(scope.held.map((h) => [h.roleId, h.expiresAt]));
      const wanted = [...new Set(roleIds)].map((roleId) => ({ roleId, expiresAt: kept.get(roleId) ?? null }));
      await this.apply(tx, actor, userId, scope, wanted, 'user.roles.replace');
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
      const scope = await this.scope(tx, actor, userId);
      const named = new Set(staff.map((s) => s.roleId));
      // 고객 역할과, 요청이 말하지 않은 «기간이 지난» 직원 부여는 그대로 둔다 — 화면은 만료 기록을 꺼진 채로
      // 보여 줄 뿐이라, 다른 역할만 고친 저장이 그 기록까지 지우면 안 된다. 지우는 건 회수(removeMember)다.
      const now = Date.now();
      const untouched = scope.held
        .filter(
          (h) =>
            isCustomerRole(h.name) || (!named.has(h.roleId) && h.expiresAt !== null && h.expiresAt.getTime() <= now),
        )
        .map((h) => ({ roleId: h.roleId, expiresAt: h.expiresAt }));
      await this.apply(tx, actor, userId, scope, [...untouched, ...staff], 'user.roles.replace');
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
        const scope = await this.scope(tx, actor, userId);
        const others = scope.held
          .filter((h) => h.roleId !== roleId)
          .map((h) => ({ roleId: h.roleId, expiresAt: h.expiresAt }));
        await this.apply(tx, actor, userId, scope, [...others, { roleId, expiresAt: end }], 'role.members.add');
      }
    });
  }

  /** 역할 하나를 회수한다 — 요청자 테넌트의 부여에서. */
  async removeMember(actor: IamActor, roleId: string, userId: string): Promise<void> {
    await this.dbService.run(async (tx) => {
      const scope = await this.scope(tx, actor, userId);
      const rest = scope.held
        .filter((h) => h.roleId !== roleId)
        .map((h) => ({ roleId: h.roleId, expiresAt: h.expiresAt }));
      await this.apply(tx, actor, userId, scope, rest, 'role.member.remove');
    });
  }

  /** 탈퇴 전 확인 — 지금 직원 역할이 유효한 계정은 스스로 떠날 수 없다. 역할 회수가 먼저다. */
  async assertNotStaff(userId: string, tx?: UserServiceTx): Promise<void> {
    await this.dbService.run(async (tx) => {
      if (await this.roles.hasLiveStaffRole(userId, tx)) throw new IamStaffCannotLeaveError();
    }, tx);
  }

  /**
   * 관리자가 만드는 계정의 테넌트 = 요청자 테넌트(다른 테넌트의 첫 master 는 운영자 API 의 길이다). 계정 행보다 먼저 정해야 행에
   * 실리므로 첫 역할(`assignOnCreate`)과 따로 묻는다. 계정은 그 테넌트의 것이고 만든 뒤 바뀌지 않는다(ADR-0056).
   */
  tenantForNewAccount(actor: IamActor, tx: UserServiceTx): Promise<string> {
    return this.operators.workingTenant(actor, tx);
  }

  /**
   * 관리자 계정을 만들 때의 첫 역할 — `tenantForNewAccount` 가 정한 계정의 테넌트에서, 같은 규칙·같은 트랜잭션으로 준다.
   * 소속은 판정에 쓰지 않지만 소속 표를 걷는 contract(티켓 10) 전까지 계속 쓴다 — 옛 코드로 되돌리면 옛 코드는 소속으로 판정한다.
   */
  async assignOnCreate(
    tx: UserServiceTx,
    actor: IamActor,
    userId: string,
    roleId: string,
    tenantId: string,
  ): Promise<void> {
    await this.tenancy.addMembership(userId, tenantId, tx);
    await this.apply(
      tx,
      actor,
      userId,
      { tenantId, held: [], elsewhere: new Set() },
      [{ roleId, expiresAt: null }],
      'admin_user.create',
    );
  }

  /**
   * 운영자가 대상 테넌트의 첫 master 를 세운다 — `PlatformTenantManager` 의 첫 master 만들기만 부른다(운영자 성질은 거기서 본다).
   * 그 테넌트의 다른 부여는 그대로 두고 역할 하나를 더한다. 규칙(권한 상승 방지·계정의 테넌트)과 이력은 다른 부여와 같다.
   */
  async grantInTenant(tx: UserServiceTx, actor: IamActor, userId: string, roleId: string, tenantId: string) {
    const scope = await this.scopeIn(tx, userId, tenantId);
    const others = scope.held
      .filter((h) => h.roleId !== roleId)
      .map((h) => ({ roleId: h.roleId, expiresAt: h.expiresAt }));
    await this.apply(tx, actor, userId, scope, [...others, { roleId, expiresAt: null }], 'role.members.add');
  }

  private async apply(
    tx: UserServiceTx,
    actor: IamActor,
    userId: string,
    scope: TenantScope,
    wanted: readonly WantedAssignment[],
    action: IamAuditAction,
  ): Promise<void> {
    const { tenantId, held } = scope;
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

    await this.authority.assertCanGrant(
      tx,
      actor,
      touched.map((id) => nameOf.get(id) ?? ''),
    );
    if (added.some((a) => scope.elsewhere.has(a.roleId))) throw new IamGrantedElsewhereError();
    // 주거나 늘리는 것은 그 테넌트의 계정에만(ADR-0056) — 고객 역할도 같다. 회수는 계정의 테넌트와 무관하게 된다: 이 테넌트에
    // 남은 어긋난 부여(채우기 전에 생긴 것)를 거두는 길이고, 거두는 것은 이 테넌트의 부여뿐이다.
    if (added.length + retimed.length > 0 && user.tenantId !== tenantId) throw new IamNotAccountTenantError();

    await this.roles.deleteAssignments(userId, tenantId, removed, tx);
    await this.roles.insertAssignments(userId, tenantId, added, tx);
    for (const r of retimed) await this.roles.updateExpiry(userId, tenantId, r.roleId, r.expiresAt, tx);

    const view = (rows: readonly WantedAssignment[]) =>
      rows.map((r) => ({ roleId: r.roleId, name: nameOf.get(r.roleId) ?? '', expiresAt: r.expiresAt }));
    await this.audit.record(tx, actor, {
      tenantId,
      action,
      targetType: 'user',
      targetId: userId,
      targetLabel: user.loginId,
      before: view(held.map((h) => ({ roleId: h.roleId, expiresAt: h.expiresAt }))),
      after: view(wanted),
    });
  }
}
