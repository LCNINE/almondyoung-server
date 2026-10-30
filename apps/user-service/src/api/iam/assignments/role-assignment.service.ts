import { Injectable } from '@nestjs/common';
import type { IamActor } from '../iam-actor';
import type {
  AddRoleMembersDto,
  ReplaceStaffRolesDto,
  ReplaceUserRolesDto,
  RoleMemberDto,
  UserRolesResponseDto,
} from './dto/role-assignment.dto';
import { RoleAssignmentManager } from './role-assignment.manager';
import { RoleAssignmentReader } from './role-assignment.reader';

@Injectable()
export class RoleAssignmentService {
  constructor(
    private readonly reader: RoleAssignmentReader,
    private readonly manager: RoleAssignmentManager,
  ) {}

  rolesOf(userId: string): Promise<UserRolesResponseDto> {
    return this.reader.rolesOf(userId);
  }

  replaceAll(actor: IamActor, userId: string, dto: ReplaceUserRolesDto): Promise<void> {
    return this.manager.replaceAll(actor, userId, dto.roleIds);
  }

  replaceStaff(actor: IamActor, userId: string, dto: ReplaceStaffRolesDto): Promise<void> {
    return this.manager.replaceStaff(actor, userId, dto.assignments);
  }

  members(roleId: string): Promise<RoleMemberDto[]> {
    return this.reader.members(roleId);
  }

  addMembers(actor: IamActor, roleId: string, dto: AddRoleMembersDto): Promise<void> {
    return this.manager.addMembers(actor, roleId, dto.userIds, dto.expiresAt, dto.tenantId);
  }

  removeMember(actor: IamActor, roleId: string, userId: string): Promise<void> {
    return this.manager.removeMember(actor, roleId, userId);
  }
}
