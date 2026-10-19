import { Injectable } from '@nestjs/common';
import type { IamActor } from '../iam-actor';
import type {
  CreateRoleDto,
  ReplaceRolePermissionsDto,
  RoleDetailDto,
  RoleSummaryDto,
  UpdateRoleDto,
} from './dto/role-admin.dto';
import { RoleAdminManager } from './role-admin.manager';
import { RoleAdminReader } from './role-admin.reader';

@Injectable()
export class RoleAdminService {
  constructor(
    private readonly reader: RoleAdminReader,
    private readonly manager: RoleAdminManager,
  ) {}

  list(): Promise<RoleSummaryDto[]> {
    return this.reader.list();
  }

  detail(roleId: string): Promise<RoleDetailDto> {
    return this.reader.detail(roleId);
  }

  async create(actor: IamActor, dto: CreateRoleDto): Promise<RoleDetailDto> {
    const roleId = await this.manager.create(actor, dto);
    return this.reader.detail(roleId);
  }

  async update(actor: IamActor, roleId: string, dto: UpdateRoleDto): Promise<RoleDetailDto> {
    await this.manager.update(actor, roleId, dto);
    return this.reader.detail(roleId);
  }

  async replacePermissions(actor: IamActor, roleId: string, dto: ReplaceRolePermissionsDto): Promise<RoleDetailDto> {
    await this.manager.replacePermissions(actor, roleId, dto);
    return this.reader.detail(roleId);
  }

  delete(actor: IamActor, roleId: string, version: number): Promise<void> {
    return this.manager.delete(actor, roleId, version);
  }
}
