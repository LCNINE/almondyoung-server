import { NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, count, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import * as schema from '../../../database/drizzle/schema';
import { AddressDto } from '../../commons/dto/address.dto';
import { DbTransaction } from '../../commons/types';
import { ProviderType } from '../../commons/types/auth.type';
import { isValidUUID } from '../../commons/utils/is-valid-uuid';
import { NICKNAME_RULE_MESSAGE, isValidNickname } from '../../commons/utils/nickname';
import { phoneNumberDigitVariants } from '../../commons/utils/phone-number';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserDetailsResponseDto } from './dto/user-details.response.dto';
import { UserRolesResponse } from './dto/user-role-scopes.response.dto';
import { UserRolesReader } from './user-roles.reader';

/** 비밀번호를 뺀 계정 칸 — 이메일 조회가 돌려주는 모양(`schema.UserWithoutPassword`). */
const userWithoutPasswordColumns = {
  id: schema.users.id,
  loginId: schema.users.loginId,
  username: schema.users.username,
  nickname: schema.users.nickname,
  email: schema.users.email,
  isEmailVerified: schema.users.isEmailVerified,
  mustChangePassword: schema.users.mustChangePassword,
  lastActivityAt: schema.users.lastActivityAt,
  deletedAt: schema.users.deletedAt,
  dormantAt: schema.users.dormantAt,
  createdAt: schema.users.createdAt,
  updatedAt: schema.users.updatedAt,
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    @InjectPublisher(USER_STREAM)
    private readonly eventPublisher: PublisherFor<typeof USER_STREAM>,
    private readonly userRolesReader: UserRolesReader,
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
          mustChangePassword: schema.users.mustChangePassword,
          lastActivityAt: schema.users.lastActivityAt,
          deletedAt: schema.users.deletedAt,
          dormantAt: schema.users.dormantAt,
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
        .select(userWithoutPasswordColumns)
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      return users ?? null;
    } catch (error) {
      console.log('error:', error);
      throw new InternalServerErrorException('이메일로 사용자 조회 중 오류가 발생했습니다.');
    }
  }

  /**
   * userId 묶음 → 알림 발송용 연락처. 서버 간(internal) 호출 전용이다.
   *
   * 탈퇴(deletedAt)·휴면(dormantAt) 계정은 제외한다 — 법정 고지라도 탈퇴자에겐 보내지 않는다.
   * 못 찾은 userId 는 조용히 빠진다(호출자가 개수 차이로 판단).
   */
  async findContactsByIds(userIds: string[]): Promise<
    { userId: string; email: string; username: string; phoneNumber: string | null; marketingConsent: boolean }[]
  > {
    if (userIds.length === 0) return [];
    const rows = await this.dbService.db
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        username: schema.users.username,
        phoneNumber: schema.profiles.phoneNumber,
        marketingConsent: schema.userConsents.marketingConsent,
      })
      .from(schema.users)
      .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .leftJoin(schema.userConsents, eq(schema.userConsents.userId, schema.users.id))
      .where(
        and(inArray(schema.users.id, userIds), isNull(schema.users.deletedAt), isNull(schema.users.dormantAt)),
      );
    return rows.map((row) => ({ ...row, marketingConsent: row.marketingConsent ?? false }));
  }

  // 전화번호·발송 대상으로 계정을 찾는 내부 조회 넷은 호출 테넌트의 계정만 본다(ADR-0056) — 다른 테넌트에 같은 번호가 있어도
  // 그 테넌트의 문자 답장·수신거부가 이 테넌트 회원에게 닿지 않게.
  async findActiveContactsByPhone(
    tenantId: string,
    phoneNumber: string,
    tx?: DbTransaction,
  ): Promise<{ userId: string; username: string }[]> {
    const users = await this.findUsersByPhoneNumber(tenantId, phoneNumber, tx);
    return users.filter((u) => !u.deletedAt && !u.dormantAt).map((u) => ({ userId: u.id, username: u.username }));
  }

  /** 폰 문자 대량 발송 대상: 활성(탈퇴·휴면 아님) 회원 중 휴대폰 번호가 있는 사람 전원. */
  async findSmsAudience(
    tenantId: string,
    marketingOnly: boolean,
    tx?: DbTransaction,
  ): Promise<{ userId: string; username: string; phoneNumber: string; marketingConsent: boolean }[]> {
    const rows = await this.getClient(tx)
      .select({
        userId: schema.users.id,
        username: schema.users.username,
        phoneNumber: schema.profiles.phoneNumber,
        marketingConsent: schema.userConsents.marketingConsent,
      })
      .from(schema.users)
      .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .leftJoin(schema.userConsents, eq(schema.userConsents.userId, schema.users.id))
      .where(
        and(
          ...this.smsAudienceConditions(tenantId),
          marketingOnly ? eq(schema.userConsents.marketingConsent, true) : undefined,
        ),
      )
      .orderBy(schema.users.createdAt);
    return rows.map((row) => ({ ...row, phoneNumber: row.phoneNumber ?? '', marketingConsent: row.marketingConsent ?? false }));
  }

  async summarizeSmsAudience(
    tenantId: string,
    tx?: DbTransaction,
  ): Promise<{ active: number; withPhone: number; consented: number }> {
    const client = this.getClient(tx);
    const [active] = await client
      .select({ value: count() })
      .from(schema.users)
      .where(and(eq(schema.users.tenantId, tenantId), isNull(schema.users.deletedAt), isNull(schema.users.dormantAt)));
    const [withPhone] = await client
      .select({
        value: count(),
        consented: sql<number>`count(*) filter (where ${schema.userConsents.marketingConsent} = true)`.mapWith(Number),
      })
      .from(schema.users)
      .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .leftJoin(schema.userConsents, eq(schema.userConsents.userId, schema.users.id))
      .where(and(...this.smsAudienceConditions(tenantId)));
    return { active: active?.value ?? 0, withPhone: withPhone?.value ?? 0, consented: withPhone?.consented ?? 0 };
  }

  private smsAudienceConditions(tenantId: string) {
    return [
      eq(schema.users.tenantId, tenantId),
      isNull(schema.users.deletedAt),
      isNull(schema.users.dormantAt),
      isNotNull(schema.profiles.phoneNumber),
      ne(schema.profiles.phoneNumber, ''),
    ];
  }

  async withdrawMarketingConsentByPhone(
    tenantId: string,
    phoneNumber: string,
    via: string,
    tx?: DbTransaction,
  ): Promise<{ userIds: string[]; withdrawnUserIds: string[] }> {
    const users = await this.findUsersByPhoneNumber(tenantId, phoneNumber, tx);
    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) return { userIds, withdrawnUserIds: [] };

    const withdrawn = await this.getClient(tx)
      .update(schema.userConsents)
      .set({
        marketingConsent: false,
        marketingConsentWithdrawnAt: new Date(),
        marketingConsentWithdrawnVia: via,
        updatedAt: new Date(),
      })
      .where(and(inArray(schema.userConsents.userId, userIds), eq(schema.userConsents.marketingConsent, true)))
      .returning({ userId: schema.userConsents.userId });
    return { userIds, withdrawnUserIds: withdrawn.map((row) => row.userId) };
  }

  // 가입 가능 여부 확인 셋 — 회원가입 폼의 사전 중복 체크용. 중복 여부만 boolean 으로 반환한다(PII 미노출).
  // 가입 시점 중복 검증과 같은 조회를 쓴다: 그 테넌트 안의 계정만 중복이다(ADR-0056).
  async isEmailAvailable(tenantId: string, email: string, tx?: DbTransaction): Promise<boolean> {
    return (await this.findUserByEmailInTenant(tenantId, email, tx)) === null;
  }

  async isLoginIdAvailable(tenantId: string, loginId: string, tx?: DbTransaction): Promise<boolean> {
    return (await this.findUserByLoginIdInTenant(tenantId, loginId, tx)) === null;
  }

  async isNicknameAvailable(tenantId: string, nickname: string, tx?: DbTransaction): Promise<boolean> {
    return (await this.findUserByNicknameInTenant(tenantId, nickname, tx)) === null;
  }

  // 그 테넌트에서 이 휴대폰 번호를 쓰는 계정 (복수 가능). 전화번호는 unique 가 아니라 다른 테넌트에도 같은 번호가 있다(ADR-0056).
  async findUsersByPhoneNumber(tenantId: string, phoneNumber: string, tx?: DbTransaction): Promise<schema.User[]> {
    const client = this.getClient(tx);
    try {
      const rows = await client
        .select({
          user: schema.users,
        })
        .from(schema.users)
        .innerJoin(schema.profiles, eq(schema.users.id, schema.profiles.userId))
        // 저장된 표기가 E.164/하이픈/숫자로 섞여 있어, 숫자만 남긴 값으로 비교한다
        .where(
          and(
            eq(schema.users.tenantId, tenantId),
            inArray(
              sql`regexp_replace(${schema.profiles.phoneNumber}, '[^0-9]', '', 'g')`,
              phoneNumberDigitVariants(phoneNumber),
            ),
          ),
        );

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

  /** 그 테넌트의 계정만 찾는다(ADR-0056). 로그인 아이디 unique 가 테넌트 안으로 넓혀진 뒤에도 한 행이다. */
  async findUserByLoginIdInTenant(tenantId: string, loginId: string, tx?: DbTransaction): Promise<schema.User | null> {
    const client = this.getClient(tx);
    const [user] = await client
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.loginId, loginId)))
      .limit(1);
    return user ?? null;
  }

  /** 그 테넌트의 계정 id. 비밀번호 재설정 토큰의 `sub` 가 다른 테넌트 계정을 가리키면 없는 계정이다(ADR-0056). */
  async findUserByIdInTenant(tenantId: string, userId: string, tx?: DbTransaction): Promise<schema.User | null> {
    if (!isValidUUID(userId)) return null;
    const [user] = await this.getClient(tx)
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.id, userId)))
      .limit(1);
    return user ?? null;
  }

  /**
   * 그 테넌트 계정 중 이 이메일을 쓰는 것. 가입·소셜 가입의 이메일 중복과 레거시 재설정 토큰(이메일 문자열)은 테넌트 안에서만 본다(ADR-0056).
   */
  async findUserByEmailInTenant(
    tenantId: string,
    email: string,
    tx?: DbTransaction,
  ): Promise<schema.UserWithoutPassword | null> {
    const client = this.getClient(tx);
    const [user] = await client
      .select(userWithoutPasswordColumns)
      .from(schema.users)
      .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.email, email)))
      .limit(1);
    return user ?? null;
  }

  /** 그 테넌트 계정 중 이 닉네임을 쓰는 것. 닉네임은 DB unique 가 없어 이 조회가 유일한 중복 검사다. */
  async findUserByNicknameInTenant(
    tenantId: string,
    nickname: string,
    tx?: DbTransaction,
  ): Promise<schema.UserWithoutPassword | null> {
    const client = this.getClient(tx);
    const [user] = await client
      .select(userWithoutPasswordColumns)
      .from(schema.users)
      .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.nickname, nickname)))
      .limit(1);
    return user ?? null;
  }

  /**
   * 소셜 로그인의 «기존 계정» — 이 소셜 신원(provider, provider 쪽 id)이 붙은 그 테넌트의 계정. 다른 테넌트 계정에 붙은
   * 같은 신원은 이 테넌트에선 처음 보는 신원이다(ADR-0056).
   */
  async findSocialAccountInTenant(
    tenantId: string,
    provider: ProviderType,
    providerId: string,
    tx?: DbTransaction,
  ): Promise<schema.UserWithoutPassword | null> {
    const client = this.getClient(tx);
    const [row] = await client
      .select({ user: userWithoutPasswordColumns })
      .from(schema.userIdentities)
      .innerJoin(schema.users, eq(schema.userIdentities.userId, schema.users.id))
      .where(
        and(
          eq(schema.users.tenantId, tenantId),
          eq(schema.userIdentities.provider, provider),
          eq(schema.userIdentities.providerId, providerId),
        ),
      )
      .limit(1);
    return row?.user ?? null;
  }

  /**
   * 계정의 테넌트 — 토큰의 `tenant`·역할이 이것으로 정해진다. 비어 있으면 채우기 마이그(…_backfill-account-tenant)가 안 돈
   * DB 다 — 테넌트 1 로 짐작하지 않고 멈춘다(기본 테넌트 없음).
   */
  async accountTenantOf(userId: string, tx?: DbTransaction): Promise<string> {
    const client = this.getClient(tx);
    const [row] = await client
      .select({ tenantId: schema.users.tenantId })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!row) throw new NotFoundError('사용자를 찾을 수 없습니다.');
    if (!row.tenantId) throw new Error(`account ${userId} has no tenant — run the account tenant backfill migration`);
    return row.tenantId;
  }

  // 공개 API용 기본 정보
  async findUserById(id: string, tx?: DbTransaction) {
    const client = this.getClient(tx);
    return this.getUserBaseInfo(id, client);
  }

  /**
   * 탈퇴 계정을 "없는 사용자" 로 취급해 조회한다.
   *
   * auth-web 의 `/oauth/authorize` 는 `/users/me` 가 200 을 주는지로 활성 세션을 판정한다.
   * 탈퇴한 계정에도 200 을 주면 로그인 화면을 거치지 않고 silent SSO 로 다시 들어온다.
   * 관리자 화면은 탈퇴 회원도 봐야 하므로 `findUserById` 는 그대로 두고, 인증 경로만 이걸 쓴다.
   */
  async findActiveUserById(id: string, tx?: DbTransaction) {
    const user = await this.findUserById(id, tx);
    if (user.deletedAt || user.dormantAt) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
    return user;
  }

  // 사용자 프로필 정보 업데이트
  async updateMyProfile(userId: string, updateUserDto: UpdateUserDto, tx?: DbTransaction): Promise<void> {
    const { username, nickname, phoneNumber, birthDate, profileImageUrl, address, interestCategoryKeys } =
      updateUserDto;

    const client = this.getClient(tx);

    if (nickname) {
      const [current] = await client
        .select({ nickname: schema.users.nickname })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      if (nickname !== current?.nickname && !isValidNickname(nickname)) {
        throw new BadRequestException(NICKNAME_RULE_MESSAGE);
      }
    }

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
   * 사용자의 활성 역할 이름 목록 — 모든 테넌트의 부여. 토큰에 싣는 역할은 `getTokenRoleNames` 다.
   * expiresAt 이 null 이거나 미래인 역할만 포함한다.
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
          or(isNull(schema.userRoleAssignments.expiresAt), gt(schema.userRoleAssignments.expiresAt, new Date())),
        ),
      );
    return [...new Set(rows.map((r) => r.roleName))];
  }

  /**
   * 토큰에 싣는 역할 — 토큰 테넌트에서 받은 살아 있는 부여만. 다른 테넌트의 부여가 섞이면 그 테넌트의 권한이 이 토큰으로
   * 넘어간다(역할 정의는 전역이다).
   */
  async getTokenRoleNames(userId: string, tenantId: string, tx?: DbTransaction): Promise<string[]> {
    const client = this.getClient(tx);
    const rows = await client
      .select({ roleName: schema.roles.name })
      .from(schema.userRoleAssignments)
      .innerJoin(schema.roles, eq(schema.userRoleAssignments.roleId, schema.roles.roleId))
      .where(
        and(
          eq(schema.userRoleAssignments.userId, userId),
          eq(schema.userRoleAssignments.tenantId, tenantId),
          or(isNull(schema.userRoleAssignments.expiresAt), gt(schema.userRoleAssignments.expiresAt, new Date())),
        ),
      );
    return [...new Set(rows.map((r) => r.roleName))];
  }

  // 사용자의 권한 정보 조회
  async getUserRoles(userId: string): Promise<UserRolesResponse> {
    try {
      const user = await this.getUserBaseInfo(userId);
      const roles = await this.userRolesReader.findLiveRoles(userId);
      return { userId: user.id, roles };
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
  async assignUserRole(userId: string, roleId: string, tenantId: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    this.logger.debug('사용자-역할 할당 시작');

    const [assignment] = await client
      .insert(schema.userRoleAssignments)
      .values({
        userId: userId,
        roleId: roleId,
        tenantId,
      })
      .returning();

    this.logger.debug(`사용자-역할 할당 완료: ${JSON.stringify(assignment)}`);

    return;
  }

  /** 고객 가입의 고객 역할. 테넌트는 가입을 받은 고정 테넌트 앱(쇼핑몰)의 테넌트다. */
  async assignDefaultRoleToUser(userId: string, tenantId: string, tx?: DbTransaction): Promise<void> {
    const [role] = await this.findByRoleName('user', tx);

    if (!role) throw new InternalServerErrorException();
    await this.assignUserRole(userId, role.roleId, tenantId, tx);

    return;
  }
}
