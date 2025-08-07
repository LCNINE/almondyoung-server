import { DbService, InjectDb } from '@app/db';
import { EventPublisherService, InjectEventPublisher } from '@app/events';
import { UserEvents } from '@app/shared/events/user.events';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../../../database/drizzle/schema';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<schema.User>,
    @InjectEventPublisher()
    private readonly eventPublisher: EventPublisherService<UserEvents>,
  ) {}

  // 기본 사용자 정보를 가져오는 메서드
  private async getUserBaseInfo(userId: string) {
    try {
      const [user] = await this.dbService.db
        .select({
          id: schema.users.id,
          loginId: schema.users.loginId,
          username: schema.users.username,
          email: schema.users.email,
          isEmailVerified: schema.users.isEmailVerified,
          lastActivityAt: schema.users.lastActivityAt,
          createdAt: schema.users.createdAt,
          updatedAt: schema.users.updatedAt,
        })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);

      if (!user) {
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      }

      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        '사용자 정보 조회 중 오류가 발생했습니다.',
      );
    }
  }

  // 사용자의 역할과 스코프 정보를 가져오는 메서드
  private async getUserRolesAndScopes(userId: string) {
    try {
      return await this.dbService.db
        .select({
          role: {
            id: schema.roles.roleId,
            name: schema.roles.name,
          },
          scopes: {
            scope_name: schema.scopes.scopeName,
            description: schema.scopes.description,
          },
        })
        .from(schema.userRoleAssignments)
        .where(
          and(
            eq(schema.userRoleAssignments.userId, userId),
            isNull(schema.userRoleAssignments.expiresAt),
          ),
        )
        .leftJoin(
          schema.roles,
          eq(schema.userRoleAssignments.roleId, schema.roles.roleId),
        )
        .leftJoin(
          schema.roleScopes,
          eq(schema.roles.roleId, schema.roleScopes.roleId),
        )
        .leftJoin(
          schema.scopes,
          eq(schema.roleScopes.scopeId, schema.scopes.scopeId),
        );
    } catch (error) {
      throw new InternalServerErrorException(
        '사용자 권한 정보 조회 중 오류가 발생했습니다.',
      );
    }
  }

  // 사용자의 확장 정보를 가져오는 메서드
  private async getUserExtendedInfo(userId: string) {
    try {
      const [userData] = await this.dbService.db
        .select({
          shop: schema.shops,
          profile: schema.profiles,
        })
        .from(schema.users)
        .leftJoin(schema.shops, eq(schema.users.id, schema.shops.userId))
        .leftJoin(schema.profiles, eq(schema.users.id, schema.profiles.userId))
        .where(eq(schema.users.id, userId))
        .limit(1);

      return userData;
    } catch (error) {
      throw new InternalServerErrorException(
        '사용자 정보 조회 중 오류가 발생했습니다.',
      );
    }
  }

  // 이메일로 사용자 찾기
  async findUserByEmail(email: string): Promise<schema.User | null> {
    try {
      const [users] = await this.dbService.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      return users;
    } catch (error) {
      throw new InternalServerErrorException(
        '이메일로 사용자 조회 중 오류가 발생했습니다.',
      );
    }
  }

  // 사용자명으로 사용자 찾기
  async findUserByUsername(username: string): Promise<schema.User | null> {
    try {
      const [users] = await this.dbService.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, username))
        .limit(1);

      return users;
    } catch (error) {
      throw new InternalServerErrorException(
        '사용자명으로 사용자 조회 중 오류가 발생했습니다.',
      );
    }
  }

  // 로그인 ID로 사용자 찾기
  async findUserByLoginId(id: string): Promise<schema.User | null> {
    try {
      const [users] = await this.dbService.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.loginId, id))
        .limit(1);

      return users;
    } catch (error) {
      throw new InternalServerErrorException(
        '로그인 ID로 사용자 조회 중 오류가 발생했습니다.',
      );
    }
  }

  // 공개 API용 기본 정보
  async findUserById(id: string) {
    return this.getUserBaseInfo(id);
  }

  // 사용자 정보 업데이트
  async update(userId: string, updateUserDto: UpdateUserDto): Promise<void> {
    const { username, ...address } = updateUserDto;

    if (!username && Object.keys(address).length === 0) {
      throw new BadRequestException('업데이트할 데이터가 없습니다.');
    }

    try {
      if (username) {
        await this.dbService.db
          .update(schema.users)
          .set({ username })
          .where(eq(schema.users.id, userId));
      }

      if (Object.keys(address).length > 0) {
        await this.dbService.db
          .insert(schema.profiles)
          .values({
            userId,
            address,
          })
          .onConflictDoUpdate({
            target: schema.profiles.userId,
            set: {
              address,
            },
          });
      }

      await this.eventPublisher.publishEvent('USER_UPDATED', {
        userId,
        ...updateUserDto,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        '사용자 정보 업데이트 중 오류가 발생했습니다.',
      );
    }
  }

  // 사용자의 권한 정보 조회
  async getUserRoles(userId: string) {
    try {
      const user = await this.getUserBaseInfo(userId);
      const roles = await this.getUserRolesAndScopes(userId);

      return {
        userId: user.id,
        roles,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        '사용자 권한 정보를 불러오는 중 오류가 발생했습니다.',
      );
    }
  }

  // 특정 사용자의 상세 정보
  async getUserDetails(userId: string) {
    try {
      const [baseInfo, extendedInfo] = await Promise.all([
        this.getUserBaseInfo(userId),
        this.getUserExtendedInfo(userId),
      ]);

      if (!baseInfo) {
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      }

      return {
        ...baseInfo,
        ...extendedInfo,
      };
    } catch (error) {
      console.log('error:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        '사용자 상세 정보를 불러오는 중 오류가 발생했습니다.',
      );
    }
  }

  // 현재 사용자의 정보를 조회합니다.
  async retrieveMe(userId: string) {
    return this.getUserBaseInfo(userId);
  }

  async findByRoleName(roleName: string) {
    return await this.dbService.db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, roleName))
      .limit(1);
  }

  // 사용자에게 역할을 할당해줍니다.
  async assignUserRole(userId: string, roleId: string): Promise<void> {
    this.logger.debug('사용자-역할 할당 시작');

    const [assignment] = await this.dbService.db
      .insert(schema.userRoleAssignments)
      .values({
        userId: userId,
        roleId: roleId,
      })
      .returning();

    this.logger.debug(`사용자-역할 할당 완료: ${JSON.stringify(assignment)}`);

    return;
  }

  async assignDefaultRoleToUser(userId: string): Promise<void> {
    const [role] = await this.findByRoleName('user');
    if (!role) throw new InternalServerErrorException();
    await this.assignUserRole(userId, role.roleId);

    return;
  }
}
