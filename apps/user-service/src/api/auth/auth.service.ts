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
  userServiceEnums,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import * as bcrypt from 'bcrypt';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DbTransaction, IUser, ProviderType } from '../../commons/types';
import {
  JWT_ACCESS_TOKEN_EXPIRATION,
  JWT_EMAIL_VERIFICATION_ACCESS_TOKEN_EXPIRATION,
  JWT_REFRESH_TOKEN_EXPIRATION,
  JWT_REFRESH_TOKEN_LONG_EXPIRATION,
  JWT_RESET_PASSWORD_ACCESS_TOKEN_EXPIRATION,
} from '../../constants/auth.constant';
import { ConsentsService } from '../consents/consents.service';
import { TokensService } from '../tokens/tokens.service';
import { UsersService } from '../users/users.service';
import { SignInDto } from './dto/sign-in.dto';
import { LocalSignUpDto } from './dto/sign-up.dto';
import { getCookieOptions, getDomain, logCookieDebugInfo } from './utils/cookies';

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
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  private getFrontendUrlByOrigin(origin: string): string {
    // localhost 개발 환경
    if (origin?.includes('localhost:3000')) {
      return 'http://localhost:3000';
    }

    // Vercel Preview 배포
    if (origin?.includes('vercel.app')) {
      return origin;
    }

    // 프로덕션
    if (origin === this.configService.get('FRONTEND_URL')) {
      return this.configService.getOrThrow('FRONTEND_URL');
    }

    return this.configService.getOrThrow('FRONTEND_URL');
  }

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction) {
    return tx ? fn(tx) : this.dbService.db.transaction(fn);
  }

  private getSocialRedirectUrl(provider: ProviderType, userId: string, origin: string): string {
    return new URL(`/${provider}/callback?userId=${userId}`, this.getFrontendUrlByOrigin(origin)).toString();
  }

  async signUp(
    signUpDto: LocalSignUpDto,
    @Res() reply: FastifyReply,
    redirect_to?: string,
  ): Promise<{ message: string }> {
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
    } = signUpDto;

    let expiresIn = JWT_EMAIL_VERIFICATION_ACCESS_TOKEN_EXPIRATION;

    try {
      // 이메일로 기존 사용자 조회
      const existingUser = await this.usersService.findUserByEmail(signUpDto.email);

      if (existingUser) {
        // 이미 인증된 이메일인 경우
        if (existingUser.isEmailVerified) {
          throw new ConflictException('이미 가입된 이메일입니다. 로그인을 시도해주세요.');
        }

        // 새로운 인증 토큰 생성
        const verificationToken = await this.jwtService.signAsync(
          { sub: existingUser.id },
          {
            secret: this.configService.getOrThrow<string>('AUTH_SECRET'),
            expiresIn: this.parseExpiresIn(expiresIn),
          },
        );

        // 새 토큰 저장 (기존 토큰 자동 삭제)
        await this.tokensService.saveVerificationToken(
          existingUser.id,
          verificationToken,
          new Date(Date.now() + this.parseExpiresIn(expiresIn)),
        );

        await this.eventPublisher.publishEvent({
          eventType: 'UserVerification',
          aggregateId: existingUser.id,
          payload: {
            userId: existingUser.id,
            email: existingUser.email,
            name: existingUser.username,
            verificationToken: verificationToken,
            callbackUrl: this.configService.get('USER_SERVICE_URL') + `/auth/verify-email`,
            redirectTo: redirect_to ?? '/',
          },
        });

        console.log(
          '회원가입 이메일 인증 링크: ',
          this.configService.get('USER_SERVICE_URL') +
            `/auth/verify-email?token=${verificationToken}&redirect_to=${encodeURIComponent(redirect_to ?? '')}`,
        );
        /* 
        ex)
         this.configService.get('USER_SERVICE_URL') +
              `/auth/verify-email?token=${verificationToken}&redirect_to=${encodeURIComponent(redirect_to ?? '')}`,        
        */

        return {
          message: '이전에 가입 시도한 이력이 있습니다. 새로운 인증 링크를 해당 이메일로 발송했습니다.',
        };
      }

      const existsUserId = await this.usersService.findUserByLoginId(signUpDto.loginId);
      if (existsUserId) {
        throw new ConflictException('이미 존재하는 아이디입니다.');
      }

      const existingUserByNickname = await this.usersService.findUserByNickname(signUpDto.nickname);

      if (existingUserByNickname) {
        throw new ConflictException('이미 존재하는 닉네임입니다.');
      }

      const saltOrRounds = 10;
      const hash = await bcrypt.hash(signUpDto.password, saltOrRounds);

      return await this.dbService.db.transaction(async (tx) => {
        // 새 사용자 생성
        const [user] = await tx
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

        // 유저 동의 항목 생성
        await tx.insert(userServiceSchema.userConsents).values({
          userId: user.id,
          isOver14,
          termsOfService,
          electronicTransaction,
          privacyPolicy,
          thirdPartySharing,
          marketingConsent,
        });

        // 이메일 인증용 토큰 생성
        const verificationToken = await this.jwtService.signAsync(
          { sub: user.id as string },
          {
            secret: this.configService.getOrThrow<string>('JWT_VERIFICATION_TOKEN_SECRET'),
            expiresIn: this.parseExpiresIn(expiresIn),
          },
        );

        // 토큰 저장
        await this.tokensService.saveVerificationToken(
          user.id,
          verificationToken,
          new Date(Date.now() + this.parseExpiresIn(expiresIn)),
          tx,
        );

        await this.eventPublisher.publishEvent({
          eventType: 'UserVerification',
          aggregateId: user.id,
          payload: {
            userId: user.id,
            email: user.email,
            name: user.username,
            verificationToken: verificationToken,
            callbackUrl: this.configService.get('USER_SERVICE_URL') + `/auth/verify-email`,
            redirectTo: redirect_to ?? '/',
          },
        });

        return {
          message: '이메일로 인증 링크가 발송되었습니다. 인증을 완료해 주세요.',
        };
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      console.error('회원가입 중 오류:', error);
      throw new InternalServerErrorException('회원가입 중 오류가 발생했습니다.');
    }
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

      return reply.status(302).redirect(url.toString());
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof InternalServerErrorException) {
        throw error;
      }
      console.error('이메일 인증 중 오류:', error);
      throw new InternalServerErrorException('이메일 인증 중 오류가 발생했습니다.');
    }
  }

  async callbackSignup(userId: string, reply: FastifyReply, origin: string, redirectTo?: string, tx?: DbTransaction) {
    return this.inTx(async (trx) => {
      const user = await this.usersService.findUserById(userId, trx);
      if (!user) throw new NotFoundException('존재하지 않는 사용자입니다');

      // 기본 역할 설정을 'user'로 하고 기본권한 부여
      await this.usersService.assignDefaultRoleToUser(user.id, trx);

      const { accessToken } = await this.setAccessToken(user, reply, origin, trx);
      const { refreshToken } = await this.setRefreshToken(user.id, reply, false, origin, trx);
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
    origin: string,
  ): Promise<void | { accessToken: string; refreshToken: string }> {
    const user = await this.usersService.findUserByLoginId(signInDto.loginId);

    if (!user) throw new NotFoundException('존재하지 않는 사용자입니다');

    if (user.deletedAt) {
      throw new ForbiddenException('휴면 처리된 사용자입니다. 관리자에게 문의해주세요.');
    }

    if (!user.isEmailVerified) {
      throw new ForbiddenException('이메일 인증이 필요한 사용자입니다.');
    }

    const isAuth = await bcrypt.compare(signInDto.password, user.password);
    if (!isAuth) throw new BadRequestException('비밀번호가 일치하지 않습니다');

    const { refreshToken } = await this.setRefreshToken(user.id, reply, signInDto.rememberMe, origin);
    const { accessToken } = await this.setAccessToken(user, reply, origin);

    // 마지막 활동일 업데이트
    await this.lastActivityAtUpdate(user);

    return { accessToken, refreshToken };
  }

  async signInWithSocial(
    socialUser: {
      name: string;
      email: string;
      providerId: string;
    },
    provider: ProviderType,
    reply: FastifyReply,
    origin: string,
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

      return reply.status(302).redirect(this.getSocialRedirectUrl(provider, result.user.id, origin));
    } else {
      return await this.dbService.db.transaction(async (transaction) => {
        const result = await processSignIn(transaction);

        return reply.status(302).redirect(this.getSocialRedirectUrl(provider, result.user.id, origin));
      });
    }
  }

  async setSocialCookie(userId: string, reply: FastifyReply, origin: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const user = await this.usersService.findUserById(userId, client);

    if (!user) throw new NotFoundException('존재하지 않는 사용자입니다');

    const { refreshToken } = await this.setRefreshToken(user.id, reply, false, origin, tx);
    const { accessToken } = await this.setAccessToken(user, reply, origin, tx);
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

    // 새 사용자 생성
    const [newUser] = await tx
      .insert(userServiceSchema.users)
      .values({
        loginId: `${provider}_${socialUser.providerId}`,
        username: socialUser.name,
        nickname: socialUser.name,
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

        const frontendUrl = this.getFrontendUrlByOrigin(req.headers.origin!);

        // 쿠키 삭제
        reply.clearCookie('accessToken', {
          path: '/',
          domain: `.${getDomain(frontendUrl)}`,
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
        });
        reply.clearCookie('refreshToken', {
          path: '/',
          domain: `.${getDomain(frontendUrl)}`,
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
        });
        reply.clearCookie('_medusa_jwt', {
          path: '/',
          domain: `.${getDomain(frontendUrl)}`,
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

  private async getUserScopes(userId: string, tx?: DbTransaction): Promise<string[]> {
    const client = this.getClient(tx);

    const userScopes = await client
      .select({
        scopeName: userServiceSchema.scopes.scopeName,
        roleName: userServiceSchema.roles.name,
      })
      .from(userServiceSchema.scopes)
      .innerJoin(
        userServiceSchema.roleScopes,
        eq(userServiceSchema.scopes.scopeId, userServiceSchema.roleScopes.scopeId),
      )
      .innerJoin(userServiceSchema.roles, eq(userServiceSchema.roleScopes.roleId, userServiceSchema.roles.roleId))
      .innerJoin(
        userServiceSchema.userRoleAssignments,
        eq(userServiceSchema.roles.roleId, userServiceSchema.userRoleAssignments.roleId),
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

    const uniqueScopes = [...new Set(userScopes.map((scope) => scope.scopeName))];

    return uniqueScopes;
  }

  private async setAccessToken(
    user: IUser,
    reply: FastifyReply,
    origin: string,
    tx?: DbTransaction,
  ): Promise<{ accessToken: string }> {
    const client = this.getClient(tx);
    const scopes = await this.getUserScopes(user.id, tx);

    if (scopes.length === 0) {
      throw new UnauthorizedException('사용자에게 할당된 권한이 없습니다. 관리자에게 문의해주세요.');
    }

    const payload = {
      sub: user.id,
      scopes,
      email: user.email,
    };

    const expiresIn = JWT_ACCESS_TOKEN_EXPIRATION;

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('AUTH_SECRET'),
      expiresIn,
    });
    const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
    const isProd = process.env.NODE_ENV === 'production';
    const corsOrigin = this.getFrontendUrlByOrigin(origin);

    // 쿠키 옵션 생성
    const cookieOptions = getCookieOptions({
      isRailway,
      isProd,
      corsOrigin,
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
    origin: string,
    tx?: DbTransaction,
  ): Promise<{ refreshToken: string }> {
    const client = this.getClient(tx);

    const scopes = await this.getUserScopes(userId, tx);

    // 자동 로그인 여부에 따라 만료 시간 결정
    const expiresIn = this.getRefreshTokenExpiration(rememberMe);

    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, scopes },
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn,
      },
    );

    const expiresAt = new Date(Date.now() + this.parseExpiresIn(expiresIn));

    // 리프레시 토큰 저장 (기존 토큰 자동 삭제)
    await this.tokensService.saveRefreshToken(userId, refreshToken, scopes, expiresAt, rememberMe, tx);
    const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
    const isProd = process.env.NODE_ENV === 'production';
    const corsOrigin = this.getFrontendUrlByOrigin(origin);

    // 쿠키 옵션 생성
    const cookieOptions = getCookieOptions({
      isRailway,
      isProd,
      corsOrigin,
    });

    // 개발 환경에서만 디버깅 로그
    if (!isProd) {
      logCookieDebugInfo({ isRailway, isProd, corsOrigin }, cookieOptions);
    }

    reply.setCookie('refreshToken', refreshToken, cookieOptions);

    return { refreshToken };
  }

  async restoreToken(userId: string, reply: FastifyReply, origin: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const user = await this.usersService.findUserById(userId, client);

    return await this.setAccessToken(user, reply, origin, client);
  }

  async forgetUserId(email: string) {
    const user = await this.usersService.findUserByEmail(email);
    if (!user) throw new NotFoundException('존재하지 않는 이메일입니다');

    // ID 찾기 이벤트 발행
    await this.eventPublisher.publishEvent({
      eventType: 'UserFindId',
      aggregateId: email,
      payload: {
        email,
        loginId: user.loginId,
      },
    });
  }

  async forgotPassword(email: string, loginId: string) {
    const user = await this.usersService.findUserByEmail(email);
    if (!user) throw new NotFoundException('존재하지 않는 이메일입니다');
    if (user.loginId !== loginId) throw new NotFoundException('존재하지 않는 아이디입니다');

    const verificationToken = await this.jwtService.signAsync(
      { email },
      {
        secret: this.configService.getOrThrow('AUTH_SECRET'),
        expiresIn: JWT_RESET_PASSWORD_ACCESS_TOKEN_EXPIRATION,
      },
    );

    await this.eventPublisher.publishEvent({
      eventType: 'UserResetPassword',
      aggregateId: email,
      payload: {
        email,
        verificationToken,
      },
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const email = await this.jwtService.verify(token, {
      secret: this.configService.getOrThrow('AUTH_SECRET'),
    });

    if (typeof email !== 'string') {
      throw new BadRequestException('Invalid token');
    }

    const user = await this.usersService.findUserByEmail(email);
    if (!user) {
      throw new NotFoundException(`No user found for email: ${email}`);
    }

    const saltOrRounds = 10;
    const hash = await bcrypt.hash(password, saltOrRounds);

    const result = await this.dbService.db
      .update(userServiceSchema.users)
      .set({ password: hash })
      .where(eq(userServiceSchema.users.id, user.id));

    return;
  }

  async changePassword(password: string, userId: string, tx?: DbTransaction) {
    const existingUser = await this.usersService.findUserById(userId);

    if (!existingUser) throw new NotFoundException('존재하지 않는 사용자입니다');

    try {
      const saltOrRounds = 10;
      const hash = await bcrypt.hash(password, saltOrRounds);
      await this.dbService.db
        .update(userServiceSchema.users)
        .set({ password: hash })
        .where(eq(userServiceSchema.users.id, userId));

      return;
    } catch (error) {
      throw new InternalServerErrorException('비밀번호 변경 중 오류가 발생했습니다.');
    }
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

    const isAuth = await bcrypt.compare(password, user.password);
    if (!isAuth) throw new UnauthorizedException('비밀번호가 일치하지 않습니다');

    return;
  }

  async removeAccount(userId: string, tx?: DbTransaction): Promise<void> {
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
