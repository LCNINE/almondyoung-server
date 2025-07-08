import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { SetUserScopesDto } from './dto/set-user-scopes.dto';
import { DbService, InjectDb } from '@app/db';
import * as schema from '../../../database/drizzle/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

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
      this.logger.debug(
        `setDefaultRoles 시작 - userId: ${userId}, role: ${role}`,
      );

      //  'role' 역할이 있는지 확인하고 없으면 생성
      let userRole = await this.dbService.db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, role))
        .limit(1);

      this.logger.debug(`기존 role 조회 결과: ${JSON.stringify(userRole)}`);

      if (!userRole.length) {
        this.logger.debug('새로운 role 생성 시작');
        const description =
          role === 'admin' ? '관리자 역할' : '일반 사용자 역할';
        [userRole[0]] = await this.dbService.db
          .insert(schema.roles)
          .values({
            name: role,
            description,
          })
          .returning();
        this.logger.debug(
          `새로운 role 생성 완료: ${JSON.stringify(userRole[0])}`,
        );
      }

      //  사용자-역할 할당
      this.logger.debug('사용자-역할 할당 시작');
      const [assignment] = await this.dbService.db
        .insert(schema.userRoleAssignments)
        .values({
          userId: userId,
          roleId: userRole[0].roleId,
        })
        .returning();
      this.logger.debug(`사용자-역할 할당 완료: ${JSON.stringify(assignment)}`);

      return assignment;
    } catch (error) {
      this.logger.error('setDefaultRoles 에러:', error.stack);

      if (error.code === '23505') {
        throw new ConflictException('이미 역할이 할당되어 있습니다.');
      }

      throw error;
    }
  }
}
