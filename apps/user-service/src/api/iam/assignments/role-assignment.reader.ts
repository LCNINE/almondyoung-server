import { NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import type { IamActor } from '../iam-actor';
import { RoleRepository } from '../roles/role.repository';
import { ActorTenantReader } from '../tenancy/actor-tenant.reader';
import { isCustomerRole, isSystemRole } from '../rules/iam-rules';
import type { RoleMemberDto, UserRolesResponseDto } from './dto/role-assignment.dto';

/**
 * 부여 읽기는 요청자 테넌트 안에서만 답한다(ADR-0056) — 역할 정의는 전역이라, 거르지 않으면 공용 역할의 구성원 목록으로 다른
 * 테넌트 직원의 이름이 보인다. 다른 테넌트의 계정은 «없는 사용자»다.
 */
@Injectable()
export class RoleAssignmentReader {
  constructor(
    private readonly roles: RoleRepository,
    private readonly actorTenant: ActorTenantReader,
  ) {}

  async rolesOf(actor: IamActor, userId: string): Promise<UserRolesResponseDto> {
    const tenantId = await this.actorTenant.resolve(actor);
    const user = await this.roles.findUser(userId);
    if (!user || user.tenantId !== tenantId) throw new NotFoundError('사용자를 찾을 수 없습니다.');
    const held = (await this.roles.assignmentsOf(userId)).filter((h) => h.tenantId === tenantId);
    const details = new Map((await this.roles.findRolesByIds(held.map((h) => h.roleId))).map((r) => [r.roleId, r]));
    const now = Date.now();
    return {
      roles: held.map((h) => {
        const role = details.get(h.roleId);
        return {
          roleId: h.roleId,
          name: h.name,
          displayName: h.displayName ?? h.name,
          description: role?.description ?? null,
          audience: isCustomerRole(h.name) ? 'customer' : 'staff',
          isSystem: isSystemRole(h.name),
          assignedAt: h.assignedAt,
          expiresAt: h.expiresAt,
          expired: h.expiresAt !== null && h.expiresAt.getTime() <= now,
          createdAt: role?.createdAt ?? h.assignedAt,
          updatedAt: role?.updatedAt ?? h.assignedAt,
        };
      }),
    };
  }

  async members(actor: IamActor, roleId: string): Promise<RoleMemberDto[]> {
    const tenantId = await this.actorTenant.resolve(actor);
    if (!(await this.roles.findRole(roleId))) throw new NotFoundError('역할을 찾을 수 없습니다.');
    return this.roles.membersOf(roleId, tenantId);
  }
}
