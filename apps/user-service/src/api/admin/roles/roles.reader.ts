import { Injectable } from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { RoleResponseDto } from './dto/roles.dto';
import { UserRolesResponseDto } from './dto/user-roles.dto';
import { RoleNotFoundException, UserNotFoundException } from './exceptions/roles.exceptions';
import { RolesRepository } from './roles.repository';

@Injectable()
export class RolesReader {
  constructor(
    private readonly repo: RolesRepository,
    private readonly usersService: UsersService,
  ) {}

  async listRoles(): Promise<RoleResponseDto[]> {
    return this.repo.findAll();
  }

  async getRoleById(roleId: string): Promise<RoleResponseDto> {
    const role = await this.repo.findById(roleId);
    if (!role) throw new RoleNotFoundException('역할을 찾을 수 없습니다.');
    return role;
  }

  async getUserRoleIds(userId: string): Promise<UserRolesResponseDto> {
    const user = await this.usersService.findUserById(userId);
    if (!user) throw new UserNotFoundException('사용자를 찾을 수 없습니다.');
    const roles = await this.repo.findUserRoles(userId);
    return { roles };
  }
}
