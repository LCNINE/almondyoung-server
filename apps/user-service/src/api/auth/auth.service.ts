import { DbService, InjectDb } from '@app/db';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserEvents } from '@packages/event-contracts/streams';
import {
  User,
  UserWithoutPassword,
  userServiceEnums,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import * as bcrypt from 'bcrypt';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DbTransaction, IUser, ProviderType } from '../../commons/types';
import {
  JWT_ACCESS_TOKEN_EXPIRATION,
  JWT_EMAIL_VERIFICATION_ACCESS_TOKEN_EXPIRATION,
  JWT_PIN_RESET_VERIFICATION_TOKEN_EXPIRATION,
  JWT_REFRESH_TOKEN_EXPIRATION,
  JWT_REFRESH_TOKEN_LONG_EXPIRATION,
  JWT_RESET_PASSWORD_ACCESS_TOKEN_EXPIRATION,
} from '../../constants/auth.constant';
import { ConsentsService } from '../consents/consents.service';
import { TokensService } from '../tokens/tokens.service';
import { UsersService } from '../users/users.service';
import { Cafe24LinkService } from '../cafe24-link/cafe24-link.service';
import { SignInDto } from './dto/sign-in.dto';
import { LocalSignUpDto } from './dto/sign-up.dto';
import { getCookieOptions, getDomain, logCookieDebugInfo } from './utils/cookies';
import { generateSocialNickname } from './utils/generate-social-nickname';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    @InjectStreamPublisher('users.events.v1')
    private readonly eventPublisher: StreamPublisher<UserEvents>,
    private readonly consentsService: ConsentsService,
    private readonly tokensService: TokensService,
    private readonly cafe24LinkService: Cafe24LinkService,
  ) { }

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  private get frontendUrl(): string {
    const isProd = this.configService.get('NODE_ENV') === 'production';

    return isProd ? this.configService.getOrThrow('FRONTEND_URL') : 'http://localhost:8000';
  }


  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction) {
    return tx ? fn(tx) : this.dbService.db.transaction(fn);
  }

  private getSocialRedirectUrl(provider: ProviderType, userId: string): string {
    return new URL(`/${provider}/callback?userId=${userId}`, this.frontendUrl).toString();
  }

  async signUp(
    signUpDto: LocalSignUpDto,
    @Res() reply: FastifyReply,
    redirect_to?: string,
  ): Promise<{ userId: string, message: string }> {
    const {
      email,
      username,
      nickname,
      password,
      loginId,
      isOver14,
      termsOfService,
      electronicTransaction,
      privacyPolicy,
      thirdPartySharing,
      marketingConsent,
      birthday,
      phoneNumber,
      encryptedIdToken,
    } = signUpDto;

    const redirectTo = redirect_to ?? '/';

    try {
      return await this.dbService.db.transaction(async (tx) => {
        const client = this.getClient(tx);

        // 이메일, 아이디, 닉네임 각각 중복 체크
        const [existingEmail, existingLoginId, existingNickname] = await Promise.all([
          this.usersService.findUserByEmail(signUpDto.email, client),
          this.usersService.findUserByLoginId(signUpDto.loginId, client),
          this.usersService.findUserByNickname(signUpDto.nickname, client),
        ]);

        if (existingEmail) {
          throw new ConflictException('이미 가입된 이메일입니다.');
        }
        if (existingLoginId) {
          throw new ConflictException('이미 존재하는 아이디입니다.');
        }
        if (existingNickname) {
          throw new ConflictException('이미 존재하는 닉네임입니다.');
        }

        const saltOrRounds = 10;
        const hash = await bcrypt.hash(signUpDto.password, saltOrRounds);

        // 새 사용자 생성
        const [user] = await client
          .insert(userServiceSchema.users)
          .values({
            email,
            username,
            nickname,
            loginId,
            password: hash,
            isEmailVerified: false,
          })
          .returning();

        // 유저 프로필에 생년월일 업데이트
        await this.usersService.updateMyProfile(user.id, {
          birthDate: birthday,
          phoneNumber,
        }, client);

        // 유저 동의 항목 생성
        await client.insert(userServiceSchema.userConsents).values({
          userId: user.id,
          isOver14,
          termsOfService,
          electronicTransaction,
          privacyPolicy,
          thirdPartySharing,
          marketingConsent,
        });

        if (encryptedIdToken) {
          await this.cafe24LinkService.linkCafe24Account(
            user.id,
            encryptedIdToken,
            tx,
          );
        }

        return { userId: user.id, message: '회원가입 성공' }
      });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }
      console.error('회원가입 중 오류:', error);
      throw new InternalServerErrorException('회원가입 중 오류가 발생했습니다.');
    }
  }

  async bootstrapCafe24Signup(
    encryptedIdToken: string,
  ) {
    return this.cafe24LinkService.issueSignupBootstrapData(
      encryptedIdToken,
    );
  }

  // 회원가입 이메일 인증 완료 처리
  async signupVerifyEmail(
    token: string,
    reply: FastifyReply,
    redirectTo?: string,
  ): Promise<void | { accessToken: string }> {
    try {
      //  토큰 검증
      const verificationToken = await this.dbService.db
        .select({
          token: userServiceSchema.tokens,
          user: userServiceSchema.users,
        })
        .from(userServiceSchema.tokens)
        .innerJoin(userServiceSchema.users, eq(userServiceSchema.tokens.userId, userServiceSchema.users.id))
        .where(
          and(
            eq(userServiceSchema.tokens.value, token),
            gt(userServiceSchema.tokens.expiresAt, new Date()),
            eq(userServiceSchema.users.isEmailVerified, false),
            eq(userServiceSchema.tokens.isRevoked, false),
            eq(userServiceSchema.tokens.type, userServiceEnums.tokenTypeEnum.enumValues[2]),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]);

      if (!verificationToken) {
        console.log('유효하지 않은 인증 토큰입니다.');
        throw new UnauthorizedException('유효하지 않은 인증 토큰입니다.');
      }

      //  사용자 인증 완료 처리
      await this.dbService.db
        .update(userServiceSchema.users)
        .set({
          isEmailVerified: true,
        })
        .where(eq(userServiceSchema.users.id, verificationToken.user.id));

      //  사용된 인증 토큰 삭제
      await this.tokensService.deleteTokenByValue(token);

      let redirectUrl = this.configService.getOrThrow('SIGNUP_CALLBACK_URL');
      const url = new URL(redirectUrl);

      const redirectUrlWhitelist = this.configService
        .getOrThrow('REDIRECT_URL_WHITELIST')
        .split(',')
        .map((url) => url.trim());

      if (!redirectUrlWhitelist.includes(redirectUrl)) {
        redirectUrl = this.configService.getOrThrow('SIGNUP_CALLBACK_URL');
      }

      if (redirectTo) {
        url.searchParams.set('redirect_to', redirectTo);
        url.searchParams.set('userId', verificationToken.user.id);
      }

      await this.eventPublisher.publishEvent({
        eventType: 'UserEmailVerified',
        aggregateId: verificationToken.user.id,
        payload: {
          userId: verificationToken.user.id,
          email: verificationToken.user.email,
          name: verificationToken.user.username,
        },
      });

      return reply.status(302).redirect(url.toString());
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof InternalServerErrorException) {
        throw error;
      }
      console.error('이메일 인증 중 오류:', error);
      throw new InternalServerErrorException('이메일 인증 중 오류가 발생했습니다.');
    }
  }

  async callbackSignup(userId: string, reply: FastifyReply, redirectTo?: string, tx?: DbTransaction) {
    return this.inTx(async (trx) => {
      const user = await this.usersService.findUserById(userId, trx);
      if (!user) throw new NotFoundException('존재하지 않는 사용자입니다');

      // 기본 역할 설정을 'user'로 하고 기본권한 부여
      await this.usersService.assignDefaultRoleToUser(user.id, trx);

      const { accessToken } = await this.setAccessToken(user, reply, trx);
      const { refreshToken } = await this.setRefreshToken(user.id, reply, false, trx);
      // 마지막 활동일 업데이트
      await this.lastActivityAtUpdate(user as User, trx);

      await this.eventPublisher.publishEvent({
        eventType: 'UserCreated',
        aggregateId: user.id,
        payload: {
          userId: user.id,
          email: user.email,
          name: user.username,
        },
      });

      return { accessToken, refreshToken };
    }, tx);
  }

  // 이메일 재전송
  async resendVerificationEmail(email: string, redirectTo?: string) {
    const user = await this.usersService.findUserByEmail(email);
    if (!user) throw new NotFoundException('존재하지 않는 이메일입니다');

    const expiresIn = JWT_EMAIL_VERIFICATION_ACCESS_TOKEN_EXPIRATION;

    // 새로운 인증 토큰 생성
    const verificationToken = await this.jwtService.signAsync(
      { sub: user.id },
      {
        secret: this.configService.getOrThrow<string>('JWT_VERIFICATION_TOKEN_SECRET'),
        expiresIn,
      },
    );

    // 새 토큰 저장
    await this.tokensService.saveVerificationToken(
      user.id,
      verificationToken,
      new Date(Date.now() + this.parseExpiresIn(expiresIn)),
    );

    // 이메일 재발송
    await this.eventPublisher.publishEvent({
      eventType: 'UserVerification',
      aggregateId: user.id,
      payload: {
        userId: user.id,
        email: user.email,
        name: user.username,
        verificationToken: verificationToken,
        callbackUrl: this.configService.get('USER_SERVICE_URL') + `/auth/verify-email`,
        redirectTo: redirectTo ?? '/',
      },
    });

    return;
  }

  async signIn(
    signInDto: SignInDto,
    reply: FastifyReply,
  ): Promise<void | { accessToken: string; refreshToken: string }> {
    const user = await this.usersService.findUserByLoginId(signInDto.loginId);

    if (!user) throw new NotFoundException('존재하지 않는 사용자입니다');

    if (user.deletedAt) {
      throw new ForbiddenException('휴면 처리된 사용자입니다. 관리자에게 문의해주세요.');
    }

    const isAuth = await bcrypt.compare(signInDto.password, user.password ?? '');
    if (!isAuth) throw new BadRequestException('비밀번호가 일치하지 않습니다');

    const { refreshToken } = await this.setRefreshToken(user.id, reply, signInDto.rememberMe);
    const { accessToken } = await this.setAccessToken(user, reply);

    // 마지막 활동일 업데이트
    await this.lastActivityAtUpdate(user);

    return { accessToken, refreshToken };
  }

  async signInWithSocial(
    socialUser: {
      name: string;
      email: string;
      providerId: string;
      redirectTo?: string;
    },
    provider: ProviderType,
    reply: FastifyReply,
    tx?: DbTransaction,
  ): Promise<void | { redirectUrl: string }> {
    const processSignIn = async (transaction: DbTransaction) => {
      const existingUser = await this._signInWithSocialWithTransaction(socialUser, provider, reply, transaction);

      if (!existingUser) {
        const newUser = await this._signUpWithSocialWithTransaction(socialUser, provider, reply, transaction);

        await this.eventPublisher.publishEvent({
          eventType: 'UserCreated',
          aggregateId: newUser.user.id,
          payload: {
            userId: newUser.user.id,
            email: newUser.user.email,
            name: newUser.user.username,
          },
        });

        return newUser;
      }

      return existingUser;
    };


    if (tx) {
      const result = await processSignIn(tx);
      return reply.status(302).redirect(this.getSocialRedirectUrl(provider, result.user.id));
    } else {
      return await this.dbService.db.transaction(async (transaction) => {
        const result = await processSignIn(transaction);
        return reply.status(302).redirect(this.getSocialRedirectUrl(provider, result.user.id));
      });
    }
  }

  async setSocialCookie(userId: string, reply: FastifyReply, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const user = await this.usersService.findUserById(userId, client);

    if (!user) throw new NotFoundException('존재하지 않는 사용자입니다');

    const { refreshToken } = await this.setRefreshToken(user.id, reply, false, tx);
    const { accessToken } = await this.setAccessToken(user, reply, tx);
    await this.lastActivityAtUpdate(user as User, tx); // 마지막 활동일 업데이트

    return { accessToken, refreshToken };
  }

  // 소셜 로그인
  private async _signInWithSocialWithTransaction(
    socialUser: {
      name: string;
      email: string;
      providerId: string;
    },
    provider: ProviderType,
    reply: FastifyReply,
    tx: DbTransaction,
  ) {
    // 소셜 providerId로 기존 identity 조회
    const existingIdentity = await tx
      .select({
        identity: userServiceSchema.userIdentities,
        user: userServiceSchema.users,
      })
      .from(userServiceSchema.userIdentities)
      .innerJoin(userServiceSchema.users, eq(userServiceSchema.userIdentities.userId, userServiceSchema.users.id))
      .where(
        and(
          eq(userServiceSchema.userIdentities.provider, provider),
          eq(userServiceSchema.userIdentities.providerId, socialUser.providerId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (!existingIdentity) {
      return null;
    }
    return existingIdentity;
  }

  // 소셜 회원가입
  private async _signUpWithSocialWithTransaction(
    socialUser: {
      name: string;
      email: string;
      providerId: string;
    },
    provider: ProviderType,
    reply: FastifyReply,

    tx: DbTransaction,
  ): Promise<{ user: User }> {
    // 이메일 중복 확인
    const existingUser = await this.usersService.findUserByEmail(socialUser.email, tx);

    if (existingUser) {
      throw new Error('This email already exists');
    }

    const nickname = generateSocialNickname();

    // 새 사용자 생성
    const [newUser] = await tx
      .insert(userServiceSchema.users)
      .values({
        loginId: `${provider}_${socialUser.providerId}`,
        username: socialUser.name,
        nickname,
        email: socialUser.email,
        password: null,
        isEmailVerified: true,
      })
      .returning();

    // identity 생성
    await tx.insert(userServiceSchema.userIdentities).values({
      userId: newUser.id,
      provider: 'kakao',
      providerId: socialUser.providerId,
      providerData: {
        name: socialUser.name,
        email: socialUser.email,
      },
    });

    // 기본 역할 설정
    const userRole = await tx
      .select()
      .from(userServiceSchema.roles)
      .where(eq(userServiceSchema.roles.name, 'user'))
      .limit(1)
      .then((rows) => rows[0]);
    if (!userRole) {
      throw new Error('Default user role is not set');
    }
    await tx.insert(userServiceSchema.userRoleAssignments).values({
      userId: newUser.id,
      roleId: userRole.roleId,
    });

    return { user: newUser };
  }

  async signOut(req: FastifyRequest, reply: FastifyReply, tx?: DbTransaction) {
    return this.inTx(async (trx) => {
      const accessToken = req.cookies?.accessToken;

      try {
        if (!accessToken) {
          throw new UnauthorizedException('인증 토큰이 필요합니다.');
        }
        this.logger.log(`logout 진행중...`);

        const cookieDomain = this.configService.get<string>('COOKIE_DOMAIN');
        const normalizedCookieDomain = cookieDomain
          ? cookieDomain.startsWith('.') ? cookieDomain : `.${cookieDomain}`
          : `.${getDomain(this.frontendUrl)}`;

        // 쿠키 삭제
        reply.clearCookie('accessToken', {
          path: '/',
          domain: normalizedCookieDomain,
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
        });
        reply.clearCookie('refreshToken', {
          path: '/',
          domain: normalizedCookieDomain,
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
        });
        reply.clearCookie('_medusa_jwt', {
          path: '/',
          domain: normalizedCookieDomain,
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
        });

        this.logger.log(`logout 완료...`);

        return { message: '로그아웃되었습니다.' };
      } catch (error) {
        if (error instanceof UnauthorizedException) {
          throw error;
        }
        throw new BadRequestException('로그아웃 처리 중 오류가 발생했습니다.');
      }
    }, tx);
  }

  private async getUserRoles(userId: string, tx?: DbTransaction): Promise<string[]> {
    const client = this.getClient(tx);

    const userRoles = await client
      .select({ roleName: userServiceSchema.roles.name })
      .from(userServiceSchema.userRoleAssignments)
      .innerJoin(
        userServiceSchema.roles,
        eq(userServiceSchema.userRoleAssignments.roleId, userServiceSchema.roles.roleId),
      )
      .where(
        and(
          eq(userServiceSchema.userRoleAssignments.userId, userId),
          or(
            isNull(userServiceSchema.userRoleAssignments.expiresAt),
            gt(userServiceSchema.userRoleAssignments.expiresAt, new Date()),
          ),
        ),
      );

    return [...new Set(userRoles.map((r) => r.roleName))];
  }

  private async setAccessToken(user: IUser, reply: FastifyReply, tx?: DbTransaction): Promise<{ accessToken: string }> {
    const client = this.getClient(tx);
    const roles = await this.getUserRoles(user.id, tx);

    const payload = {
      sub: user.id,
      roles,
      email: user.email,
      login_id: user.loginId,
    };

    const expiresIn = JWT_ACCESS_TOKEN_EXPIRATION;

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('AUTH_SECRET'),
      expiresIn,
    });
    const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
    const isProd = process.env.NODE_ENV === 'production';
    const corsOrigin = this.frontendUrl;
    const cookieDomain = this.configService.get('COOKIE_DOMAIN');

    // 쿠키 옵션 생성
    const cookieOptions = getCookieOptions({
      isRailway,
      isProd,
      corsOrigin,
      cookieDomain,
    });

    // 개발 환경에서만 디버깅 로그
    if (!isProd) {
      logCookieDebugInfo({ isRailway, isProd, corsOrigin }, cookieOptions);
    }

    reply.setCookie('accessToken', accessToken, cookieOptions);

    this.logger.log(`Access token issued for user: ${user.email}`);

    return { accessToken };
  }

  async setRefreshToken(
    userId: string,
    reply: FastifyReply,
    rememberMe: boolean = false,
    tx?: DbTransaction,
  ): Promise<{ refreshToken: string }> {
    const client = this.getClient(tx);

    const roles = await this.getUserRoles(userId, tx);

    // 자동 로그인 여부에 따라 만료 시간 결정
    const expiresIn = this.getRefreshTokenExpiration(rememberMe);

    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, roles },
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn,
      },
    );

    const expiresAt = new Date(Date.now() + this.parseExpiresIn(expiresIn));

    // 리프레시 토큰 저장 (기존 토큰 자동 삭제)
    await this.tokensService.saveRefreshToken(userId, refreshToken, roles, expiresAt, rememberMe, tx);
    const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
    const isProd = process.env.NODE_ENV === 'production';
    const corsOrigin = this.frontendUrl;
    const cookieDomain = this.configService.get('COOKIE_DOMAIN');

    // 쿠키 옵션 생성
    const cookieOptions = getCookieOptions({
      isRailway,
      isProd,
      corsOrigin,
      cookieDomain,
    });

    // 개발 환경에서만 디버깅 로그
    if (!isProd) {
      logCookieDebugInfo({ isRailway, isProd, corsOrigin }, cookieOptions);
    }

    reply.setCookie('refreshToken', refreshToken, cookieOptions);

    return { refreshToken };
  }

  async restoreToken(userId: string, reply: FastifyReply, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const user = await this.usersService.findUserById(userId, client);


    return await this.setAccessToken(user, reply, client);
  }

  async forgetUserId(phoneNumber: string) {
    await this.assertPhoneVerified(phoneNumber);

    const users = await this.usersService.findUsersByPhoneNumber(phoneNumber);
    if (users.length === 0) throw new NotFoundException('존재하지 않는 휴대폰 번호입니다');

    return { loginIds: users.map((user) => user.loginId) };
  }

  async forgotPassword(phoneNumber: string, loginId: string) {
    await this.assertPhoneVerified(phoneNumber);

    const user = await this.usersService.findUserByLoginId(loginId);
    if (!user) throw new NotFoundException('존재하지 않는 아이디입니다');

    const [profile] = await this.dbService.db
      .select({
        phoneNumber: userServiceSchema.profiles.phoneNumber,
      })
      .from(userServiceSchema.profiles)
      .where(eq(userServiceSchema.profiles.userId, user.id))
      .limit(1);

    if (!profile || profile.phoneNumber !== phoneNumber) {
      throw new NotFoundException('휴대폰 번호가 일치하지 않습니다');
    }

    const verificationToken = await this.jwtService.signAsync(
      { sub: user.id },
      {
        secret: this.configService.getOrThrow('AUTH_SECRET'),
        expiresIn: JWT_RESET_PASSWORD_ACCESS_TOKEN_EXPIRATION,
      },
    );

    return { verificationToken };
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const payload = await this.jwtService.verify(token, {
      secret: this.configService.getOrThrow('AUTH_SECRET'),
    });

    let user: UserWithoutPassword | null = null;

    if (typeof payload === 'string') {
      user = await this.usersService.findUserByEmail(payload);
    } else if (payload?.sub) {
      const [row] = await this.dbService.db
        .select()
        .from(userServiceSchema.users)
        .where(eq(userServiceSchema.users.id, payload.sub))
        .limit(1);
      user = row ?? null;
    }

    if (!user) {
      throw new NotFoundException('존재하지 않는 사용자입니다');
    }

    const saltOrRounds = 10;
    const hash = await bcrypt.hash(password, saltOrRounds);

    const result = await this.dbService.db
      .update(userServiceSchema.users)
      .set({ password: hash })
      .where(eq(userServiceSchema.users.id, user.id));

    return;
  }

  private async assertPhoneVerified(phoneNumber: string) {
    const [verification] = await this.dbService.db
      .select()
      .from(userServiceSchema.phoneVerifications)
      .where(
        and(
          eq(userServiceSchema.phoneVerifications.phoneNumber, phoneNumber),
          eq(
            userServiceSchema.phoneVerifications.purpose,
            userServiceEnums.phoneVerificationPurposeEnum.enumValues[0],
          ),
          eq(userServiceSchema.phoneVerifications.isVerified, true),
          eq(userServiceSchema.phoneVerifications.isExpired, false),
          gt(userServiceSchema.phoneVerifications.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(userServiceSchema.phoneVerifications.verifiedAt))
      .limit(1);

    if (!verification) {
      throw new BadRequestException('휴대폰 인증이 필요합니다');
    }
  }

  async changePassword(currentPassword: string, newPassword: string, userId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const [user] = await client
      .select()
      .from(userServiceSchema.users)
      .where(eq(userServiceSchema.users.id, userId))
      .limit(1);

    if (!user) throw new NotFoundException('존재하지 않는 사용자입니다');

    // 소셜 로그인 사용자는 비밀번호가 없으므로 변경 불가
    if (!user.password) {
      throw new BadRequestException('소셜 로그인 사용자는 비밀번호를 변경할 수 없습니다.');
    }

    // 현재 비밀번호 검증
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      throw new BadRequestException('현재 비밀번호가 일치하지 않습니다.');
    }

    // 새 비밀번호가 현재 비밀번호와 동일한지 확인
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      throw new BadRequestException('새 비밀번호는 현재 비밀번호와 다르게 설정해주세요.');
    }

    const saltOrRounds = 10;
    const hash = await bcrypt.hash(newPassword, saltOrRounds);

    await client
      .update(userServiceSchema.users)
      .set({ password: hash })
      .where(eq(userServiceSchema.users.id, userId));
  }

  async checkPassword(password: string, userId: string, tx?: DbTransaction): Promise<void> {
    const client = await this.getClient(tx);

    const user = await client
      .select()
      .from(userServiceSchema.users)
      .where(eq(userServiceSchema.users.id, userId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!user) throw new NotFoundException('존재하지 않는 사용자입니다');

    const isAuth = await bcrypt.compare(password, user.password ?? '');
    if (!isAuth) throw new UnauthorizedException('비밀번호가 일치하지 않습니다');

    return;
  }

  async softDeleteUser(userId: string, tx?: DbTransaction): Promise<void> {
    return this.inTx(async (tx) => {
      await tx
        .update(userServiceSchema.users)
        .set({
          deletedAt: new Date(),
        })
        .where(eq(userServiceSchema.users.id, userId));

      await this.eventPublisher.publishEvent({
        eventType: 'UserDeleted',
        aggregateId: userId,
        payload: {
          userId,
        },
      });
    }, tx);
  }

  /**
 * PIN 재설정을 위한 verification token 발급
 * 로그인 비밀번호를 검증한 후, PIN_RESET scope를 가진 JWT 토큰을 발급합니다.
 */
  async verifyPasswordAndIssuePinResetToken(
    password: string,
    userId: string,
    tx?: DbTransaction,
  ): Promise<{ verificationToken: string }> {
    // 1. 로그인 비밀번호 검증
    await this.checkPassword(password, userId, tx);

    // 2. verification token 발급 (JWT with scope: PIN_RESET)
    const payload = {
      sub: userId,
      scopes: ['PIN_RESET'],
      purpose: 'pin_reset',
    };

    const verificationToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('AUTH_SECRET'),
      expiresIn: this.parseExpiresIn(JWT_PIN_RESET_VERIFICATION_TOKEN_EXPIRATION),
    });

    this.logger.log(`PIN reset verification token issued for user: ${userId}`);

    return { verificationToken };
  }

  // 리프레시 토큰 만료 시간 결정
  private getRefreshTokenExpiration(rememberMe: boolean) {
    if (rememberMe) {
      // 자동 로그인 체크 = 90일
      return JWT_REFRESH_TOKEN_LONG_EXPIRATION;
    } else {
      // 일반 로그인 = 2주
      return JWT_REFRESH_TOKEN_EXPIRATION;
    }
  }

  private async lastActivityAtUpdate(user: User, tx?: DbTransaction) {
    const client = this.getClient(tx);

    await client
      .update(userServiceSchema.users)
      .set({ lastActivityAt: new Date() })
      .where(eq(userServiceSchema.users.id, user.id)); // 마지막 활동일 업데이트
  }

  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhdw])$/);
    if (!match) return 15 * 60 * 1000; // 기본값 15분

    const value = match[1];
    const unit = match[2];
    const num = parseInt(value, 10);

    switch (unit) {
      case 's':
        return num * 1000;
      case 'm':
        return num * 60 * 1000;
      case 'h':
        return num * 60 * 60 * 1000;
      case 'd':
        return num * 24 * 60 * 60 * 1000;
      case 'w':
        return num * 7 * 24 * 60 * 60 * 1000;
      default:
        return 15 * 60 * 1000;
    }
  }
}
