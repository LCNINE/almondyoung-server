import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import * as schema from '../../../database/drizzle/schema';
import { UserRoleResponseDto } from './dto/user-role-scopes.response.dto';

@Injectable()
export class UserRolesReader {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  /** 지금 유효한 역할 부여 전부(고객 역할 포함), 이름순. */
  async findLiveRoles(userId: string): Promise<UserRoleResponseDto[]> {
    return this.dbService.db
      .select({
        role: {
          id: schema.roles.roleId,
          name: schema.roles.name,
        },
      })
      .from(schema.userRoleAssignments)
      .innerJoin(schema.roles, eq(schema.userRoleAssignments.roleId, schema.roles.roleId))
      .where(
        and(
          eq(schema.userRoleAssignments.userId, userId),
          or(isNull(schema.userRoleAssignments.expiresAt), gt(schema.userRoleAssignments.expiresAt, new Date())),
        ),
      )
      .orderBy(asc(schema.roles.name));
  }
}
