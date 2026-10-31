import { DbService, InjectDb } from '@app/db';
import { NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import type { UserServiceSchema, UserServiceTx } from 'apps/user-service/database/drizzle/schema';
import { IamAuditCreator } from '../audit/iam-audit.creator';
import type { IamActor } from '../iam-actor';
import { IamRepository } from '../iam.repository';
import {
  RoleHasMembersError,
  RoleNameTakenError,
  RoleVersionStaleError,
  SystemRoleImmutableError,
} from '../iam.errors';
import { MyPermissionsReader } from '../my-permissions.reader';
import {
  assertGrantable,
  assertPermissionSet,
  assertRoleName,
  isCustomerRole,
  isSystemRole,
  type PermissionState,
} from '../rules/iam-rules';
import type { CreateRoleDto, ReplaceRolePermissionsDto, UpdateRoleDto } from './dto/role-admin.dto';
import { RoleRepository, type RoleRow } from './role.repository';
import { PlatformOperatorManager } from '../tenancy/platform-operator.manager';

const labelOf = (row: RoleRow) => row.displayName ?? row.name;

/** 빈 설명은 «설명 없음»(null)과 같다 — 입력란이 ''로 시작해도 바뀐 것이 없으면 저장하지 않게. */
const blankToNull = (value: string | undefined): string | null | undefined =>
  value === undefined ? undefined : value.trim() === '' ? null : value;

@Injectable()
export class RoleAdminManager {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly roles: RoleRepository,
    private readonly iam: IamRepository,
    private readonly audit: IamAuditCreator,
    private readonly myPermissions: MyPermissionsReader,
    private readonly operators: PlatformOperatorManager,
  ) {}

  async create(actor: IamActor, dto: CreateRoleDto): Promise<string> {
    assertRoleName(dto.name);
    const held = await this.actorPermissions(actor);
    return this.dbService.run(async (tx) => {
      // 역할 정의는 전역이고 테넌트는 이력에만 남는다. 다른 테넌트용 역할을 만드는 것은 운영자만 한다.
      const tenantId = await this.operators.workingTenant(actor, dto.tenantId, tx);
      if (await this.roles.findRoleByName(dto.name, tx)) {
        throw new RoleNameTakenError(`'${dto.name}' 역할이 이미 있습니다.`);
      }
      const states = await this.states(tx);
      const permissions = dto.copyFromRoleId
        ? await this.livePermissionsOf(dto.copyFromRoleId, states, tx)
        : [...new Set(dto.permissions ?? [])].sort();
      assertPermissionSet(permissions, [], states);
      assertGrantable(held, permissions, states, '역할을 만들 수 없습니다');
      const created = await this.roles.insertRole(
        {
          name: dto.name,
          displayName: dto.displayName,
          description: blankToNull(dto.description) ?? null,
          landingPath: dto.landingPath ?? null,
        },
        tx,
      );
      if (!created) throw new RoleNameTakenError(`'${dto.name}' 역할이 이미 있습니다.`);
      await this.roles.replaceGrants(created.roleId, permissions, [], actor.userId, tx);
      await this.audit.record(tx, actor, {
        tenantId,
        action: 'role.create',
        targetType: 'role',
        targetId: created.roleId,
        targetLabel: dto.displayName,
        before: null,
        after: {
          version: created.version,
          name: dto.name,
          displayName: dto.displayName,
          description: blankToNull(dto.description) ?? null,
          landingPath: dto.landingPath ?? null,
          permissions,
          copiedFromRoleId: dto.copyFromRoleId ?? null,
        },
      });
      return created.roleId;
    });
  }

  async update(actor: IamActor, roleId: string, dto: UpdateRoleDto): Promise<void> {
    await this.dbService.run(async (tx) => {
      const row = await this.lockEditable(roleId, dto.version, tx);
      const patch: { displayName?: string; description?: string | null; landingPath?: string | null } = {};
      const before: Record<string, unknown> = { version: row.version };
      const after: Record<string, unknown> = { version: row.version + 1 };
      if (dto.displayName !== undefined && dto.displayName !== labelOf(row)) {
        patch.displayName = dto.displayName;
        before.displayName = labelOf(row);
        after.displayName = dto.displayName;
      }
      const description = blankToNull(dto.description);
      if (description !== undefined && description !== row.description) {
        patch.description = description;
        before.description = row.description;
        after.description = description;
      }
      if (dto.landingPath !== undefined && dto.landingPath !== row.landingPath) {
        patch.landingPath = dto.landingPath;
        before.landingPath = row.landingPath;
        after.landingPath = dto.landingPath;
      }
      if (Object.keys(patch).length === 0) return;
      await this.roles.updateRole(roleId, patch, tx);
      await this.audit.record(tx, actor, {
        tenantId: await this.operators.workingTenant(actor, undefined, tx),
        action: 'role.update',
        targetType: 'role',
        targetId: roleId,
        targetLabel: labelOf(row),
        before,
        after,
      });
    });
  }

  async replacePermissions(actor: IamActor, roleId: string, dto: ReplaceRolePermissionsDto): Promise<void> {
    const held = await this.actorPermissions(actor);
    await this.dbService.run(async (tx) => {
      const row = await this.lockEditable(roleId, dto.version, tx);
      const before = await this.roles.grantsOf(roleId, tx);
      const next = [...new Set(dto.permissions)].sort();
      const states = await this.states(tx);
      assertPermissionSet(next, before, states);
      const had = new Set(before);
      const wanted = new Set(next);
      const added = next.filter((k) => !had.has(k));
      const removed = before.filter((k) => !wanted.has(k));
      if (added.length === 0 && removed.length === 0) return;
      // 바뀐 뒤 권한 전체를 내가 가져야 한다(Kubernetes RBAC 와 같다 — 회수되는 권한은 묻지 않는다).
      assertGrantable(held, next, states, '이 역할의 권한을 바꿀 수 없습니다');
      await this.roles.replaceGrants(roleId, added, removed, actor.userId, tx);
      await this.roles.bumpVersion(roleId, tx);
      await this.audit.record(tx, actor, {
        tenantId: await this.operators.workingTenant(actor, undefined, tx),
        action: 'role.permissions.replace',
        targetType: 'role',
        targetId: roleId,
        targetLabel: labelOf(row),
        before: { version: row.version, permissions: before },
        after: { version: row.version + 1, permissions: next, added, removed },
      });
    });
  }

  async delete(actor: IamActor, roleId: string, version: number): Promise<void> {
    await this.dbService.run(async (tx) => {
      const row = await this.lockEditable(roleId, version, tx);
      const holders = await this.roles.countAssignments(roleId, tx);
      if (holders > 0) {
        throw new RoleHasMembersError(
          `이 역할의 부여 기록이 ${holders}건 있어 지울 수 없습니다(기간이 지난 부여 포함). 먼저 역할을 회수하세요.`,
        );
      }
      const permissions = await this.roles.grantsOf(roleId, tx);
      await this.roles.deleteRole(roleId, tx);
      await this.audit.record(tx, actor, {
        tenantId: await this.operators.workingTenant(actor, undefined, tx),
        action: 'role.delete',
        targetType: 'role',
        targetId: roleId,
        targetLabel: labelOf(row),
        before: {
          version: row.version,
          name: row.name,
          displayName: labelOf(row),
          description: row.description,
          landingPath: row.landingPath,
          permissions,
        },
        after: null,
      });
    });
  }

  private async lockEditable(roleId: string, version: number, tx: UserServiceTx): Promise<RoleRow> {
    const row = await this.roles.lockRole(roleId, tx);
    if (!row) throw new NotFoundError('역할을 찾을 수 없습니다.');
    if (isSystemRole(row.name)) throw new SystemRoleImmutableError('시스템 역할은 바꾸거나 지울 수 없습니다.');
    if (isCustomerRole(row.name)) throw new SystemRoleImmutableError('고객 역할은 관리 화면에서 바꾸지 않습니다.');
    if (row.version !== version) throw new RoleVersionStaleError();
    return row;
  }

  /** 복제 원본의 «지금» 활성 권한(시스템 역할이면 활성 권한 전체). 복제본은 원본과 따로 움직인다. */
  private async livePermissionsOf(
    roleId: string,
    states: ReadonlyMap<string, PermissionState>,
    tx: UserServiceTx,
  ): Promise<string[]> {
    const source = await this.roles.findRole(roleId, tx);
    if (!source) throw new NotFoundError('복사할 역할을 찾을 수 없습니다.');
    const live = (key: string) => {
      const state = states.get(key);
      return state !== undefined && !state.deprecated && !state.systemOnly;
    };
    if (isSystemRole(source.name)) return [...states.keys()].filter(live).sort();
    return (await this.roles.grantsOf(roleId, tx)).filter(live);
  }

  private async states(tx: UserServiceTx): Promise<Map<string, PermissionState>> {
    const rows = await this.iam.findPermissionFlags(tx);
    return new Map(rows.map((r) => [r.key, { systemOnly: r.systemOnly, deprecated: r.deprecatedAt !== null }]));
  }

  /** 토큰의 역할 중 지금도 유효한 것의 권한 — 토큰 발급 뒤 기간이 끝나거나 회수된 역할은 근거가 못 된다. */
  private async actorPermissions(actor: IamActor): Promise<Set<string>> {
    const active = new Set(await this.roles.activeRoleNamesOf(actor.userId));
    const names = actor.roles.filter((name) => active.has(name));
    return new Set((await this.myPermissions.forRoles(names)).permissions);
  }
}
