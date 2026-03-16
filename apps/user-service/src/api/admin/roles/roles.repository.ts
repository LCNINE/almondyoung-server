import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import {
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { eq, inArray } from 'drizzle-orm';
import { CreateRoleDto, RoleResponseDto, UpdateRoleDto } from './dto/roles.dto';

@Injectable()
export class RolesRepository {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  async findAll(): Promise<RoleResponseDto[]> {
    return this.dbService.db
      .select()
      .from(userServiceSchema.roles)
      .orderBy(userServiceSchema.roles.createdAt);
  }

  async findById(roleId: string): Promise<RoleResponseDto | null> {
    const [role] = await this.dbService.db
      .select()
      .from(userServiceSchema.roles)
      .where(eq(userServiceSchema.roles.roleId, roleId));
    return role ?? null;
  }

  async findByName(name: string): Promise<RoleResponseDto | null> {
    const [role] = await this.dbService.db
      .select()
      .from(userServiceSchema.roles)
      .where(eq(userServiceSchema.roles.name, name));
    return role ?? null;
  }

  async findByIds(roleIds: string[]): Promise<RoleResponseDto[]> {
    if (roleIds.length === 0) return [];
    return this.dbService.db
      .select()
      .from(userServiceSchema.roles)
      .where(inArray(userServiceSchema.roles.roleId, roleIds));
  }

  async create(data: CreateRoleDto): Promise<RoleResponseDto> {
    const [role] = await this.dbService.db
      .insert(userServiceSchema.roles)
      .values(data)
      .returning();
    return role;
  }

  async update(roleId: string, data: UpdateRoleDto): Promise<RoleResponseDto> {
    const [role] = await this.dbService.db
      .update(userServiceSchema.roles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userServiceSchema.roles.roleId, roleId))
      .returning();
    return role;
  }

  async delete(roleId: string): Promise<void> {
    await this.dbService.db
      .delete(userServiceSchema.roles)
      .where(eq(userServiceSchema.roles.roleId, roleId));
  }

  async findUserRoles(userId: string): Promise<RoleResponseDto[]> {
    return this.dbService.db
      .select({
        roleId: userServiceSchema.roles.roleId,
        name: userServiceSchema.roles.name,
        description: userServiceSchema.roles.description,
        createdAt: userServiceSchema.roles.createdAt,
        updatedAt: userServiceSchema.roles.updatedAt,
      })
      .from(userServiceSchema.userRoleAssignments)
      .innerJoin(
        userServiceSchema.roles,
        eq(userServiceSchema.userRoleAssignments.roleId, userServiceSchema.roles.roleId),
      )
      .where(eq(userServiceSchema.userRoleAssignments.userId, userId));
  }

  async replaceUserRoles(userId: string, roleIds: string[]): Promise<void> {
    await this.dbService.db.transaction(async (trx) => {
      await trx
        .delete(userServiceSchema.userRoleAssignments)
        .where(eq(userServiceSchema.userRoleAssignments.userId, userId));
      if (roleIds.length > 0) {
        await trx
          .insert(userServiceSchema.userRoleAssignments)
          .values(roleIds.map((roleId) => ({ userId, roleId })));
      }
    });
  }
}
