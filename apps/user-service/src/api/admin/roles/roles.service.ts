import { Injectable } from '@nestjs/common';
import { CreateRoleDto, RoleResponseDto, UpdateRoleDto } from './dto/roles.dto';
import { ReplaceUserRolesDto, UserRolesResponseDto } from './dto/user-roles.dto';
import { RolesManager } from './roles.manager';
import { RolesReader } from './roles.reader';

@Injectable()
export class RolesService {
  constructor(
    private readonly reader: RolesReader,
    private readonly manager: RolesManager,
  ) {}

  listRoles(): Promise<RoleResponseDto[]> {
    return this.reader.listRoles();
  }

  createRole(dto: CreateRoleDto): Promise<RoleResponseDto> {
    return this.manager.createRole(dto);
  }

  updateRole(roleId: string, dto: UpdateRoleDto): Promise<RoleResponseDto> {
    return this.manager.updateRole(roleId, dto);
  }

  deleteRole(roleId: string): Promise<void> {
    return this.manager.deleteRole(roleId);
  }

  getUserRoles(userId: string): Promise<UserRolesResponseDto> {
    return this.reader.getUserRoleIds(userId);
  }

  replaceUserRoles(userId: string, dto: ReplaceUserRolesDto): Promise<void> {
    return this.manager.replaceUserRoles(userId, dto);
  }
}
