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
  Optional,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as jwt from 'jsonwebtoken';
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
  INTERNAL_TOKEN_AUDIENCE,
  JWT_ACCESS_TOKEN_EXPIRATION,
  JWT_EMAIL_VERIFICATION_ACCESS_TOKEN_EXPIRATION,
  JWT_PIN_RESET_VERIFICATION_TOKEN_EXPIRATION,
  JWT_REFRESH_TOKEN_EXPIRATION,
  JWT_REFRESH_TOKEN_LONG_EXPIRATION,
  JWT_RESET_PASSWORD_ACCESS_TOKEN_EXPIRATION,
  JWT_SIGNUP_CALLBACK_TOKEN_EXPIRATION,
  JWT_SOCIAL_CALLBACK_TOKEN_EXPIRATION,
  JWT_PAYMENT_HANDOFF_TOKEN_EXPIRATION,
  SIGNUP_CALLBACK_TOKEN_PURPOSE,
  SOCIAL_CALLBACK_TOKEN_PURPOSE,
  PAYMENT_HANDOFF_TOKEN_PURPOSE,
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
    @Optional() private readonly cafe24LinkService?: Cafe24LinkService,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  private get frontendUrl(): string {
    const isProd = this.configService.get('NODE_ENV') === 'production';

    return isProd ? this.configService.getOrThrow('FRONTEND_URL') : 'http://localhost:8001';
  }

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction) {
    return tx ? fn(tx) : this.dbService.db.transaction(fn);
  }

  /**
   * @deprecated body 의 userId 를 그대로 신뢰하는 `/auth/social/set-cookie` 와 짝을 이루는 레거시 redirect.
   * storefront 가 새 social_token 흐름으로 이전한 뒤 후속 PR 에서 제거한다.
   */
  private getSocialRedirectUrl(provider: ProviderType, userId: string): string {
    return new URL(`/${provider}/callback?userId=${userId}`, this.frontendUrl).toString();
  }

  /**
   * 신규 소셜 콜백 redirect. URL fragment 에 단발성 social_token 만 실어 보내,
   * storefront 는 이 토큰을 `/auth/callback/social` 에 제출해 세션을 시작한다.
   * userId 는 URL 에 노출되지 않는다.
   */
  private getSocialRedirectUrlWithToken(provider: ProviderType, socialToken: string): string {
    const url = new URL(`/${provider}/callback`, this.frontendUrl);
    url.searchParams.set('social_token', socialToken);
    return url.toString();
  }

  /**
   * 단발성 social_token 발급. signInWithSocial 직후 storefront 콜백 페이지로 한 번 왕복하기 위한 용도.
   * `signupToken` 과 동일 패턴 — secret/TTL 만 따로, purpose claim 으로 교차 사용 차단.
   */
  private async issueSocialCallbackToken(userId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, purpose: SOCIAL_CALLBACK_TOKEN_PURPOSE },
      {
        secret: this.configService.getOrThrow<string>('JWT_VERIFICATION_TOKEN_SECRET'),
        expiresIn: JWT_SOCIAL_CALLBACK_TOKEN_EXPIRATION,
      },
    );
  }

  /**
   * 결제창(wallet-web) 핸드오프 토큰 발급. 인증된 고객의 storefront 세션에서 호출되며,
   * wallet-web 이 별도 서브도메인에서 OIDC silent-SSO/쿠키로 세션을 재확보하지 못하는
   * 인앱브라우저·ITP 환경을 우회하기 위한 용도. 짧은 TTL(120s) + purpose claim 으로 1회 왕복 한정.
   * 교환은 `POST /oauth/token` (grant_type=payment_handoff) 에서 confidential client 인증 후에만 가능.
   */
  async issuePaymentHandoffToken(userId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, purpose: PAYMENT_HANDOFF_TOKEN_PURPOSE },
      {
        secret: this.configService.getOrThrow<string>('JWT_VERIFICATION_TOKEN_SECRET'),
        expiresIn: JWT_PAYMENT_HANDOFF_TOKEN_EXPIRATION,
      },
    );
  }

  /**
   * 단발성 signup_token 발급. signUp 직후 / verify-email 직후 auth-web /callback/signup 으로
   * 한 번 왕복하기 위한 용도. 짧은 TTL + purpose claim 으로 다른 verification JWT 와 분리.
   */
  private async issueSignupCallbackToken(userId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, purpose: SIGNUP_CALLBACK_TOKEN_PURPOSE },
      {
        secret: this.configService.getOrThrow<string>('JWT_VERIFICATION_TOKEN_SECRET'),
        expiresIn: JWT_SIGNUP_CALLBACK_TOKEN_EXPIRATION,
      },
    );
  }

  async signUp(
    signUpDto: LocalSignUpDto,
    @Res() reply: FastifyReply,
    redirect_to?: string,
  ): Promise<{ userId: string; signupToken: string; message: string }> {
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
            isEmailVerified: true,
          })
          .returning();

        // 유저 프로필에 생년월일 업데이트
        await this.usersService.updateMyProfile(
          user.id,
          {
            birthDate: birthday,
            phoneNumber,
          },
          client,
        );

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

        if (encryptedIdToken && this.cafe24LinkService) {
          await this.cafe24LinkService.linkCafe24Account(user.id, encryptedIdToken, tx);
        }

        // 단발성 signup_token 발급. 호출자(auth-web)가 즉시 callbackSignup 으로 교환해 세션을 시작한다.
        // 이메일 인증은 isEmailVerified 플래그를 토글하는 별개 흐름이며 가입 시 강제하지 않는다.
        const signupToken = await this.issueSignupCallbackToken(user.id);

        return { userId: user.id, signupToken, message: '회원가입 성공' };
      });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }
      console.error('회원가입 중 오류:', error);
      throw new InternalServerErrorException('회원가입 중 오류가 발생했습니다.');
    }
  }

  async bootstrapCafe24Signup(encryptedIdToken: string) {
    if (!this.cafe24LinkService) {
      throw new BadRequestException('Cafe24 연동이 비활성화되어 있습니다.');
    }
    return this.cafe24LinkService.issueSignupBootstrapData(encryptedIdToken);
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

      // 이메일 인증은 isEmailVerified 플래그만 토글한다. 세션은 가입 시점에 이미 발급됐거나 별도 로그인을
      // 통해 얻으므로 여기서 signup_token 을 다시 내려줄 필요가 없다.
      if (redirectTo) {
        url.searchParams.set('redirect_to', redirectTo);
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

  async callbackSignup(signupToken: string, reply: FastifyReply, redirectTo?: string, tx?: DbTransaction) {
    // signup_token 검증: signupVerifyEmail 에서 발급된 단발성 JWT.
    // 이 검증을 통과해야만 userId 를 신뢰할 수 있다. (이전 구현은 body 의 userId 를 무검증으로 신뢰 → 계정 탈취 가능)
    let userId: string;
    try {
      const payload = await this.jwtService.verifyAsync<{ sub?: string; purpose?: string }>(signupToken, {
        secret: this.configService.getOrThrow<string>('JWT_VERIFICATION_TOKEN_SECRET'),
      });
      if (payload.purpose !== SIGNUP_CALLBACK_TOKEN_PURPOSE || !payload.sub) {
        throw new UnauthorizedException('유효하지 않은 signup token 입니다');
      }
      userId = payload.sub;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('유효하지 않은 signup token 입니다');
    }

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

    // 신규 흐름: 단발성 social_token 을 발급해 storefront 콜백 페이지로 redirect.
    // storefront 는 토큰을 /auth/callback/social 에 제출해 세션을 시작한다 (callbackSignup 과 동일 패턴).
    // 레거시 `?userId=` redirect (`getSocialRedirectUrl`) 와 `/auth/social/set-cookie` 는
    // storefront 가 새 흐름으로 이전한 뒤 후속 PR 에서 제거한다.
    if (tx) {
      const result = await processSignIn(tx);
      const socialToken = await this.issueSocialCallbackToken(result.user.id);
      return reply.status(302).redirect(this.getSocialRedirectUrlWithToken(provider, socialToken));
    } else {
      return await this.dbService.db.transaction(async (transaction) => {
        const result = await processSignIn(transaction);
        const socialToken = await this.issueSocialCallbackToken(result.user.id);
        return reply.status(302).redirect(this.getSocialRedirectUrlWithToken(provider, socialToken));
      });
    }
  }

  /**
   * storefront `/{provider}/callback` 에서 호출. 단발성 social_token 을 검증한 뒤 세션을 시작한다.
   * `callbackSignup` 과 동일한 패턴. 토큰의 purpose 가 `social_callback` 이 아니면 거부.
   */
  async callbackSocial(socialToken: string, reply: FastifyReply, tx?: DbTransaction) {
    let userId: string;
    try {
      const payload = await this.jwtService.verifyAsync<{ sub?: string; purpose?: string }>(socialToken, {
        secret: this.configService.getOrThrow<string>('JWT_VERIFICATION_TOKEN_SECRET'),
      });
      if (payload.purpose !== SOCIAL_CALLBACK_TOKEN_PURPOSE || !payload.sub) {
        throw new UnauthorizedException('유효하지 않은 social token 입니다');
      }
      userId = payload.sub;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('유효하지 않은 social token 입니다');
    }

    return this.inTx(async (trx) => {
      const user = await this.usersService.findUserById(userId, trx);
      if (!user) throw new NotFoundException('존재하지 않는 사용자입니다');

      const { accessToken } = await this.setAccessToken(user, reply, trx);
      const { refreshToken } = await this.setRefreshToken(user.id, reply, false, trx);
      await this.lastActivityAtUpdate(user as User, trx);

      return { accessToken, refreshToken };
    }, tx);
  }

  /**
   * @deprecated body 의 userId 만으로 세션을 시작하는 인증 우회 결함. 새 `callbackSocial` 로 대체.
   * storefront 가 새 흐름(`?social_token=…` → `/auth/callback/social`) 으로 이전한 뒤 후속 PR 에서 제거.
   */
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

        // SLO: access token 디코드 → 사용자별 내부 token + OAuth refresh token 일괄 revoke.
        // 토큰 만료/무효라도 cookie clearing은 진행 (idempotent logout).
        let userId: string | null = null;
        try {
          const payload = await this.jwtService.verifyAsync<{ sub?: string }>(accessToken);
          if (payload.sub) userId = payload.sub;
        } catch {
          // ignore — proceed with cookie clear
        }

        if (userId) {
          await this.tokensService.deleteAllTokens(userId, trx);
          await trx
            .update(userServiceSchema.oauthTokens)
            .set({ isRevoked: true, updatedAt: new Date() })
            .where(
              and(
                eq(userServiceSchema.oauthTokens.userId, userId),
                eq(userServiceSchema.oauthTokens.isRevoked, false),
              ),
            );
          this.logger.log(`SLO: revoked tokens for userId=${userId}`);
        }

        const cookieDomain = this.configService.get<string>('COOKIE_DOMAIN');
        const normalizedCookieDomain = cookieDomain
          ? cookieDomain.startsWith('.')
            ? cookieDomain
            : `.${cookieDomain}`
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

    // 내부 access token도 OAuth와 동일한 RS256 키로 서명. audience로 OAuth 발급 토큰과 구분.
    // NOTE: NestJS JwtService 를 쓰지 않는 이유 — auth.module 의 JwtModule 이 모듈 레벨에
    //   `secret: JWT_VERIFICATION_TOKEN_SECRET` 을 설정해 놓았는데, JwtService.getSecretKey 의
    //   precedence 가 `options?.secret || this.options.secret || (...privateKey...)` 라서
    //   호출부에서 `{ privateKey, algorithm: 'RS256' }` 을 넘겨도 모듈의 HS256 secret 이 우선
    //   적용된다. 결과적으로 jsonwebtoken 이 HMAC string 을 RS256 으로 서명하려다
    //   "must be an asymmetric key when using RS256" 으로 실패한다.
    //   → 이 경로만 jsonwebtoken 직접 호출로 우회한다.
    const accessToken = jwt.sign(payload, this.configService.getOrThrow<string>('OAUTH_JWT_PRIVATE_KEY'), {
      algorithm: 'RS256',
      expiresIn,
      issuer: this.configService.getOrThrow<string>('OAUTH_ISSUER_URL'),
      audience: INTERNAL_TOKEN_AUDIENCE,
      keyid: this.configService.getOrThrow<string>('OAUTH_JWT_KID'),
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
          eq(userServiceSchema.phoneVerifications.purpose, userServiceEnums.phoneVerificationPurposeEnum.enumValues[0]),
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

    await client.update(userServiceSchema.users).set({ password: hash }).where(eq(userServiceSchema.users.id, userId));
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
