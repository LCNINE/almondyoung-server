import { DbService, InjectDb } from '@app/db';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '../../../../database/drizzle/schema';
import { UsersService } from '../../users/users.service';
import { SetUserRoleDto } from './dto/roles.dto';
import {
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly usersService: UsersService,
  ) {}

  async setUserRole(setUserRoleDto: SetUserRoleDto): Promise<void> {
    try {
      const { userId, roleId, expires_at } = setUserRoleDto;
      //  사용자-역할 할당
      this.logger.debug('사용자-역할 할당 시작');

      const existingUser = await this.usersService.findUserById(userId);

      if (!existingUser) {
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      }

      const [assignment] = await this.dbService.db
        .insert(schema.userRoleAssignments)
        .values({
          userId: userId,
          roleId: roleId,
          expiresAt: expires_at,
        })
        .onConflictDoUpdate({
          target: [
            schema.userRoleAssignments.userId,
            schema.userRoleAssignments.roleId,
          ],
          set: {
            ...setUserRoleDto,
            expiresAt: expires_at,
          },
        })
        .returning();

      this.logger.debug(`사용자-역할 할당 완료: ${JSON.stringify(assignment)}`);

      return;
    } catch (error) {
      console.log('error:', error);
      throw new BadRequestException(
        error.message ?? '사용자-역할 할당 중 오류가 발생했습니다.',
      );
    }
  }

  async deleteUserRoleByUserId(userId: string): Promise<void> {
    try {
      const existingUser = await this.usersService.findUserById(userId);

      if (!existingUser) {
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      }

      await this.dbService.db
        .delete(schema.userRoleAssignments)
        .where(eq(schema.userRoleAssignments.userId, userId));

      return;
    } catch (error) {
      throw new BadRequestException(
        error.message ??
          '해당 사용자의 역할 할당을 삭제하는 중 오류가 발생했습니다.',
      );
    }
  }
}
