import { NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import { RoleRepository } from '../roles/role.repository';
import { isCustomerRole, isSystemRole } from '../rules/iam-rules';
import type { RoleMemberDto, UserRolesResponseDto } from './dto/role-assignment.dto';

@Injectable()
export class RoleAssignmentReader {
  constructor(private readonly roles: RoleRepository) {}

  async rolesOf(userId: string): Promise<UserRolesResponseDto> {
    const user = await this.roles.findUser(userId);
    if (!user) throw new NotFoundError('사용자를 찾을 수 없습니다.');
    const held = await this.roles.assignmentsOf(userId);
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

  async members(roleId: string): Promise<RoleMemberDto[]> {
    if (!(await this.roles.findRole(roleId))) throw new NotFoundError('역할을 찾을 수 없습니다.');
    return this.roles.membersOf(roleId);
  }
}
