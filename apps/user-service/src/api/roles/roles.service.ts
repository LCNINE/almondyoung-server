import { Injectable, ConflictException } from '@nestjs/common';
import { SetUserScopesDto } from './dto/set-user-scopes.dto';
import { DbService, InjectDb } from '@app/db';
import * as schema from '../../../database/drizzle/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class RolesService {
  constructor(@InjectDb() private readonly dbService: DbService<schema.User>) {}

  // 관리자가 스코프를 만들 수 있음
  // ex) wms-write, wms-read, wms-delete
  async setUsersScopes(SetUserScopesDto: SetUserScopesDto) {
    const scopes = SetUserScopesDto.scopes.join(',');

    await this.dbService.db.insert(schema.scopes).values({
      scopeName: scopes,
      description: SetUserScopesDto.description,
    });
  }

  // 기본적으로 user 역할 할당
  async setDefaultRoles(userId: string, role: string) {
    try {
      //  'role' 역할이 있는지 확인하고 없으면 생성
      let userRole = await this.dbService.db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, role))
        .limit(1);

      if (!userRole.length) {
        const description =
          role === 'admin' ? '관리자 역할' : '일반 사용자 역할';
        [userRole[0]] = await this.dbService.db
          .insert(schema.roles)
          .values({
            name: role,
            description,
          })
          .returning();
      }

      //  사용자-역할 할당
      const [assignment] = await this.dbService.db
        .insert(schema.userRoleAssignments)
        .values({
          userId: userId,
          roleId: userRole[0].roleId,
        })
        .returning();

      return assignment;
    } catch (error) {
      if (error.code === '23505') {
        throw new ConflictException('이미 역할이 할당되어 있습니다.');
      }

      throw error;
    }
  }
}
