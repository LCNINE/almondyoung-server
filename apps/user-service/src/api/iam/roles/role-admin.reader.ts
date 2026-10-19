import { NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import { IamRepository } from '../iam.repository';
import { isCustomerRole, isSystemRole } from '../rules/iam-rules';
import type { RoleDetailDto, RoleSummaryDto } from './dto/role-admin.dto';
import { RoleRepository, type RoleRow } from './role.repository';

interface Flag {
  readonly key: string;
  readonly dangerous: boolean;
  readonly systemOnly: boolean;
  readonly deprecatedAt: Date | null;
}

const isLive = (f: Flag) => f.deprecatedAt === null && !f.systemOnly;

@Injectable()
export class RoleAdminReader {
  constructor(
    private readonly roles: RoleRepository,
    private readonly iam: IamRepository,
  ) {}

  async list(): Promise<RoleSummaryDto[]> {
    const [rows, members, grants, flags] = await Promise.all([
      this.roles.listRoles(),
      this.roles.activeMemberCounts(),
      this.roles.grantCounts(),
      this.iam.findPermissionFlags(),
    ]);
    const live = flags.filter(isLive);
    const all = { total: live.length, dangerous: live.filter((f) => f.dangerous).length };
    return rows.map((row) =>
      this.summary(row, members.get(row.roleId) ?? 0, isSystemRole(row.name) ? all : grants.get(row.roleId)),
    );
  }

  async detail(roleId: string): Promise<RoleDetailDto> {
    const row = await this.roles.findRole(roleId);
    if (!row) throw new NotFoundError('역할을 찾을 수 없습니다.');
    const [flags, held, members] = await Promise.all([
      this.iam.findPermissionFlags(),
      this.roles.grantsOf(roleId),
      this.roles.activeMemberCounts(),
    ]);
    const retired = new Set(flags.filter((f) => f.deprecatedAt !== null).map((f) => f.key));
    const dangerous = new Set(flags.filter((f) => f.dangerous).map((f) => f.key));
    const systemOnly = new Set(flags.filter((f) => f.systemOnly).map((f) => f.key));
    const permissions = isSystemRole(row.name)
      ? flags
          .filter(isLive)
          .map((f) => f.key)
          .sort()
      : held.filter((key) => !retired.has(key));
    return {
      // 시스템 전용 권한은 목록엔 남기되(저장 때 지워지지 않게) 수에는 넣지 않는다 — 사람의 판정에 쓰이지 않는다.
      ...this.summary(row, members.get(roleId) ?? 0, {
        total: permissions.filter((k) => !systemOnly.has(k)).length,
        dangerous: permissions.filter((k) => dangerous.has(k) && !systemOnly.has(k)).length,
      }),
      permissions,
      deprecatedPermissions: isSystemRole(row.name) ? [] : held.filter((key) => retired.has(key)),
    };
  }

  private summary(
    row: RoleRow,
    memberCount: number,
    grants: { total: number; dangerous: number } | undefined,
  ): RoleSummaryDto {
    return {
      roleId: row.roleId,
      name: row.name,
      displayName: row.displayName ?? row.name,
      description: row.description,
      audience: isCustomerRole(row.name) ? 'customer' : 'staff',
      isSystem: isSystemRole(row.name),
      version: row.version,
      landingPath: row.landingPath,
      memberCount,
      permissionCount: grants?.total ?? 0,
      dangerousCount: grants?.dangerous ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
