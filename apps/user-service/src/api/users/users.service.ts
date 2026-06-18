import { DbService, InjectDb } from '@app/db';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserEvents } from '@packages/event-contracts/streams';
import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import * as schema from '../../../database/drizzle/schema';
import { roleScopeMapping as authRoleScopeMapping, scopes as authScopes } from '@app/authorization';
import { AddressDto } from '../../commons/dto/address.dto';
import { DbTransaction } from '../../commons/types';
import { isValidUUID } from '../../commons/utils/is-valid-uuid';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserDetailsResponseDto } from './dto/user-details.response.dto';
import { UserRoleScopesResponseDto, UserRolesResponse } from './dto/user-role-scopes.response.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    @InjectStreamPublisher('users.events.v1')
    private readonly eventPublisher: StreamPublisher<UserEvents>,
  ) {}
  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  // 기본 사용자 정보를 가져오는 메서드
  private async getUserBaseInfo(userId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    try {
      // UUID 형식 검증
      if (!isValidUUID(userId)) {
        throw new BadRequestException('유효하지 않은 사용자 ID 형식입니다.');
      }

      const [user] = await client
        .select({
          id: schema.users.id,
          loginId: schema.users.loginId,
          username: schema.users.username,
          nickname: schema.users.nickname,
          email: schema.users.email,
          isEmailVerified: schema.users.isEmailVerified,
          lastActivityAt: schema.users.lastActivityAt,
          deletedAt: schema.users.deletedAt,
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
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(error.message ?? '사용자 정보 조회 중 오류가 발생했습니다.');
    }
  }

  // 사용자의 역할과 스코프 정보를 가져오는 메서드
  private async getUserRolesAndScopes(userId: string): Promise<UserRoleScopesResponseDto[]> {
    try {
      return await this.dbService.db
        .select({
          role: {
            id: schema.roles.roleId,
            name: schema.roles.name,
          },
          scopes: {
            scope_name: authScopes.key,
            description: sql<string>`COALESCE(${authScopes.description}, '')`,
          },
        })
        .from(schema.userRoleAssignments)
        .where(and(eq(schema.userRoleAssignments.userId, userId), isNull(schema.userRoleAssignments.expiresAt)))
        .innerJoin(schema.roles, eq(schema.userRoleAssignments.roleId, schema.roles.roleId))
        .innerJoin(authRoleScopeMapping, eq(authRoleScopeMapping.roleName, schema.roles.name))
        .innerJoin(authScopes, eq(authRoleScopeMapping.scopeId, authScopes.id));
    } catch (error) {
      throw new InternalServerErrorException('사용자 권한 정보 조회 중 오류가 발생했습니다.');
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
      throw new InternalServerErrorException('사용자 정보 조회 중 오류가 발생했습니다.');
    }
  }

  // 이메일로 사용자 찾기
  async findUserByEmail(email: string, tx?: DbTransaction): Promise<schema.UserWithoutPassword | null> {
    const client = this.getClient(tx);
    try {
      const [users] = await client
        .select({
          id: schema.users.id,
          loginId: schema.users.loginId,
          username: schema.users.username,
          nickname: schema.users.nickname,
          email: schema.users.email,
          isEmailVerified: schema.users.isEmailVerified,
          lastActivityAt: schema.users.lastActivityAt,
          deletedAt: schema.users.deletedAt,
          createdAt: schema.users.createdAt,
          updatedAt: schema.users.updatedAt,
        })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      return users ?? null;
    } catch (error) {
      console.log('error:', error);
      throw new InternalServerErrorException('이메일로 사용자 조회 중 오류가 발생했습니다.');
    }
  }

  // 이메일 가입 가능 여부 확인 (중복 여부만 boolean 으로 반환, PII 미노출)
  // 회원가입 폼의 사전 중복 체크용. 가입 시점 중복 검증과 동일하게 findUserByEmail 을 재사용한다.
  async isEmailAvailable(email: string, tx?: DbTransaction): Promise<boolean> {
    const user = await this.findUserByEmail(email, tx);
    return user === null;
  }

  // 휴대폰 번호로 사용자 찾기 (복수 가능)
  async findUsersByPhoneNumber(phoneNumber: string, tx?: DbTransaction): Promise<schema.User[]> {
    const client = this.getClient(tx);
    try {
      const rows = await client
        .select({
          user: schema.users,
        })
        .from(schema.users)
        .innerJoin(schema.profiles, eq(schema.users.id, schema.profiles.userId))
        .where(eq(schema.profiles.phoneNumber, phoneNumber));

      return rows.map((row) => row.user);
    } catch (error) {
      throw new InternalServerErrorException('휴대폰 번호로 사용자 조회 중 오류가 발생했습니다.');
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
      throw new InternalServerErrorException('사용자명으로 사용자 조회 중 오류가 발생했습니다.');
    }
  }

  // 닉네임으로 사용자 찾기
  async findUserByNickname(nickname: string, tx?: DbTransaction): Promise<schema.User | null> {
    const client = this.getClient(tx);
    try {
      const [users] = await client.select().from(schema.users).where(eq(schema.users.nickname, nickname)).limit(1);

      return users;
    } catch (error) {
      throw new InternalServerErrorException('사용자명으로 사용자 조회 중 오류가 발생했습니다.');
    }
  }

  // 로그인 ID로 사용자 찾기
  async findUserByLoginId(id: string, tx?: DbTransaction): Promise<schema.User | null> {
    const client = this.getClient(tx);
    try {
      const [users] = await client.select().from(schema.users).where(eq(schema.users.loginId, id)).limit(1);

      return users;
    } catch (error) {
      throw new InternalServerErrorException('로그인 ID로 사용자 조회 중 오류가 발생했습니다.');
    }
  }

  // 공개 API용 기본 정보
  async findUserById(id: string, tx?: DbTransaction) {
    const client = this.getClient(tx);
    return this.getUserBaseInfo(id, client);
  }

  // 사용자 프로필 정보 업데이트
  async updateMyProfile(userId: string, updateUserDto: UpdateUserDto, tx?: DbTransaction): Promise<void> {
    const { username, nickname, phoneNumber, birthDate, profileImageUrl, address, interestCategoryKeys } =
      updateUserDto;

    const client = this.getClient(tx);

    try {
      if (username || nickname) {
        await client.update(schema.users).set({ username, nickname }).where(eq(schema.users.id, userId));
      }

      // interestCategoryKeys는 빈 배열도 명시적 초기화로 인정해야 하므로 undefined 체크 사용
      const profileData = {
        userId,
        ...(phoneNumber && { phoneNumber }),
        ...(profileImageUrl && { profileImageUrl }),
        ...(birthDate && { birthDate: new Date(birthDate) }),
        ...(address && { address: JSON.stringify(address) }),
        ...(interestCategoryKeys !== undefined && { interestCategoryKeys }),
      };

      // 업데이트할 프로필 필드가 있는 경우에만 upsert 실행
      if (Object.keys(profileData).length > 1) {
        await client
          .insert(schema.profiles)
          .values(profileData)
          .onConflictDoUpdate({
            target: schema.profiles.userId,
            set: {
              ...(phoneNumber && { phoneNumber }),
              ...(profileImageUrl && { profileImageUrl }),
              ...(birthDate && { birthDate: new Date(birthDate) }),
              ...(address && { address: JSON.stringify(address) }),
              ...(interestCategoryKeys !== undefined && { interestCategoryKeys }),
            },
          });
      }

      // 트랜잭션 컨텍스트(tx)가 주입된 경우, 커밋 이후 상위 레벨에서 이벤트를 발행하는 코드 작성.
      if (!tx) {
        await this.eventPublisher.publishEvent({
          eventType: 'UserUpdated',
          aggregateId: userId,
          payload: {
            userId,
            ...updateUserDto,
          },
        });
      }

      return;
    } catch (error) {
      throw new InternalServerErrorException('사용자 정보 업데이트 중 오류가 발생했습니다.');
    }
  }

  /**
   * 사용자의 활성 역할 이름 목록을 평문 string[] 으로 반환.
   * OAuth access_token 의 `roles` claim 에 그대로 박는 용도. expiresAt 이 null 이거나
   * 미래인 역할만 포함한다 (auth.service.ts 의 동명 메서드와 동일 정책).
   */
  async getUserRoleNames(userId: string, tx?: DbTransaction): Promise<string[]> {
    const client = this.getClient(tx);
    const rows = await client
      .select({ roleName: schema.roles.name })
      .from(schema.userRoleAssignments)
      .innerJoin(schema.roles, eq(schema.userRoleAssignments.roleId, schema.roles.roleId))
      .where(
        and(
          eq(schema.userRoleAssignments.userId, userId),
          or(
            isNull(schema.userRoleAssignments.expiresAt),
            gt(schema.userRoleAssignments.expiresAt, new Date()),
          ),
        ),
      );
    return [...new Set(rows.map((r) => r.roleName))];
  }

  // 사용자의 권한 정보 조회
  async getUserRoles(userId: string): Promise<UserRolesResponse> {
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
      throw new InternalServerErrorException('사용자 권한 정보를 불러오는 중 오류가 발생했습니다.');
    }
  }

  // 특정 사용자의 상세 정보
  async getUserDetails(userId: string): Promise<UserDetailsResponseDto> {
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
        shop: extendedInfo.shop,
        profile: extendedInfo.profile
          ? {
              ...extendedInfo.profile,
              address: extendedInfo.profile.address as AddressDto | null,
            }
          : null,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        console.log('NotFoundException:', error);
        throw error;
      }

      console.log('InternalServerErrorException:', error);
      throw new InternalServerErrorException('사용자 상세 정보를 불러오는 중 오류가 발생했습니다.');
    }
  }

  // 현재 사용자의 정보를 조회합니다.
  async retrieveMe(userId: string) {
    return this.getUserBaseInfo(userId);
  }

  async findByRoleName(roleName: string, tx?: DbTransaction) {
    const client = this.getClient(tx);
    return await client.select().from(schema.roles).where(eq(schema.roles.name, roleName)).limit(1);
  }

  // 사용자에게 역할을 할당해줍니다.
  async assignUserRole(userId: string, roleId: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    this.logger.debug('사용자-역할 할당 시작');

    const [assignment] = await client
      .insert(schema.userRoleAssignments)
      .values({
        userId: userId,
        roleId: roleId,
      })
      .returning();

    this.logger.debug(`사용자-역할 할당 완료: ${JSON.stringify(assignment)}`);

    return;
  }

  async assignDefaultRoleToUser(userId: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    const [role] = await this.findByRoleName('user', tx);

    if (!role) throw new InternalServerErrorException();
    await this.assignUserRole(userId, role.roleId, tx);

    return;
  }
}
