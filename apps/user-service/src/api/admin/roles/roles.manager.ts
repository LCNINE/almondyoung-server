import { Injectable } from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { CreateRoleDto, RoleResponseDto, UpdateRoleDto } from './dto/roles.dto';
import { ReplaceUserRolesDto } from './dto/user-roles.dto';
import {
  InvalidRoleIdsException,
  RoleAlreadyExistsException,
  RoleNotFoundException,
  UserNotFoundException,
} from './exceptions/roles.exceptions';
import { RolesRepository } from './roles.repository';

@Injectable()
export class RolesManager {
  constructor(
    private readonly repo: RolesRepository,
    private readonly usersService: UsersService,
  ) {}

  async createRole(dto: CreateRoleDto): Promise<RoleResponseDto> {
    const existing = await this.repo.findByName(dto.name);
    if (existing) throw new RoleAlreadyExistsException(`'${dto.name}' 역할이 이미 존재합니다.`);
    return this.repo.create(dto);
  }

  async updateRole(roleId: string, dto: UpdateRoleDto): Promise<RoleResponseDto> {
    const role = await this.repo.findById(roleId);
    if (!role) throw new RoleNotFoundException('역할을 찾을 수 없습니다.');
    return this.repo.update(roleId, dto);
  }

  async deleteRole(roleId: string): Promise<void> {
    const role = await this.repo.findById(roleId);
    if (!role) throw new RoleNotFoundException('역할을 찾을 수 없습니다.');
    await this.repo.delete(roleId);
  }

  async replaceUserRoles(userId: string, dto: ReplaceUserRolesDto): Promise<void> {
    const user = await this.usersService.findUserById(userId);
    if (!user) throw new UserNotFoundException('사용자를 찾을 수 없습니다.');

    if (dto.roleIds.length > 0) {
      const foundRoles = await this.repo.findByIds(dto.roleIds);
      if (foundRoles.length !== dto.roleIds.length) {
        throw new InvalidRoleIdsException('존재하지 않는 역할 ID가 포함되어 있습니다.');
      }
    }

    await this.repo.replaceUserRoles(userId, dto.roleIds);
  }
}
