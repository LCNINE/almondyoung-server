import { DbService, InjectDb } from '@app/db';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import * as schema from '../../../database/drizzle/schema';
import { User } from '../../../database/drizzle/schema';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  EventPublisherService,
  InjectEventPublisher,
} from '@app/shared/events/src';
import { UserEvents } from '@app/shared/events/user.events';

@Injectable()
export class UsersService {
  constructor(
    @InjectDb() private readonly dbService: DbService<schema.User>,

    @InjectEventPublisher()
    private readonly eventPublisher: EventPublisherService<UserEvents>,
  ) {}

  async findUserByEmail(email: string): Promise<schema.User | null> {
    const [users] = await this.dbService.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    return users;
  }

  async findUserByUsername(username: string): Promise<schema.User | null> {
    const [users] = await this.dbService.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);

    return users;
  }

  async findUserByLoginId(id: string): Promise<schema.User | null> {
    const [users] = await this.dbService.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.loginId, id))
      .limit(1);

    return users;
  }

  async findUserById(
    id: string,
  ): Promise<Omit<schema.User, 'password'> | null> {
    const [users] = await this.dbService.db
      .select({
        id: schema.users.id,
        loginId: schema.users.loginId,
        username: schema.users.username,
        email: schema.users.email,
        isEmailVerified: schema.users.isEmailVerified,
        lastActivityAt: schema.users.lastActivityAt,
        deletedAt: schema.users.deletedAt,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);

    return users;
  }

  async update(user: User, updateUserDto: UpdateUserDto): Promise<void> {
    const { username, ...address } = updateUserDto;

    if (!username && Object.keys(address).length === 0) {
      throw new BadRequestException('업데이트할 데이터가 없습니다.');
    }

    try {
      if (username) {
        await this.dbService.db
          .update(schema.users)
          .set({ username })
          .where(eq(schema.users.id, user.id));
      }

      if (Object.keys(address).length > 0) {
        await this.dbService.db
          .insert(schema.profiles)
          .values({
            userId: user.id,
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
        userId: user.id,
        ...updateUserDto,
      });

      return;
    } catch (error) {
      throw new InternalServerErrorException(
        '사용자 정보 업데이트 중 오류가 발생했습니다.',
      );
    }
  }

  async getMe(user: User) {
    try {
      const [userData] = await this.dbService.db
        .select({
          username: schema.users.username,
          profile: {
            ...schema.profiles,
          },
        })
        .from(schema.users)
        .leftJoin(schema.profiles, eq(schema.users.id, schema.profiles.userId))
        .where(eq(schema.users.id, user.id))
        .limit(1);

      if (!userData) {
        throw new NotFoundException('사용자 정보를 찾을 수 없습니다.');
      }

      const userRolesWithScopes = await this.dbService.db
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
            eq(schema.userRoleAssignments.userId, user.id),
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

      return {
        ...userData,
        id: user.id,
        isEmailVerified: user.isEmailVerified,
        roles: userRolesWithScopes,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        '사용자 정보를 불러오는 중 오류가 발생했습니다.',
      );
    }
  }
}
