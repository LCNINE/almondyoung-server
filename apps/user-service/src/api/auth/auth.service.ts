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
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  User,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import * as bcrypt from 'bcrypt';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DbTransaction, ProviderType } from '../../commons/types';
import { ConsentsService } from '../consents/consents.service';
import { NotificationEventPublisher } from '../events/notification-event.publisher';
import { UsersService } from '../users/users.service';
import { SignInDto } from './dto/sign-in.dto';
import { LocalSignUpDto } from './dto/sign-up.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    @InjectEventPublisher()
    private readonly eventPublisher: EventPublisherService<UserEvents>,
    private readonly notificationPublisher: NotificationEventPublisher,
    private readonly consentsService: ConsentsService,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  private getSocialRedirectUrl(provider: ProviderType): string {
    const frontBaseUrl =
      this.configService.get('SIGNUP_REDIRECT_URL') || 'http://localhost:3000';

    return new URL(`/auth/${provider}/callback`, frontBaseUrl).toString();
  }

  async signUp(
    signUpDto: LocalSignUpDto,
    @Res() reply: FastifyReply,
  ): Promise<{ message: string }> {
    const {
      email,
      username,
      password,
      loginId,
      isOver14,
      termsOfService,
      electronicTransaction,
      privacyPolicy,
      thirdPartySharing,
      marketingConsent,
      emailConsent,
      smsConsent,
      pushConsent,
    } = signUpDto;
    try {
      // 이메일로 기존 사용자 조회
      const existingUser = await this.usersService.findUserByEmail(
        signUpDto.email,
      );

      if (existingUser) {
        // 이미 인증된 이메일인 경우
        if (existingUser.isEmailVerified) {
          throw new ConflictException(
            '이미 가입된 이메일입니다. 로그인을 시도해주세요.',
          );
        }

        // 미인증 이메일인 경우 기존 토큰 삭제 후 재발송
        await this.dbService.db
          .delete(userServiceSchema.tokens)
          .where(
            and(
              eq(userServiceSchema.tokens.userId, existingUser.id),
              eq(
                userServiceSchema.tokens.type,
                userServiceSchema.tokenTypeEnum.enumValues[2],
              ),
            ),
          );

        const expiresIn =
          this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRATION') ??
          '15m';

        // 새로운 인증 토큰 생성
        const verificationToken = this.jwtService.sign(
          { sub: existingUser.id },
          {
            secret: this.configService.get<string>(
              'JWT_VERIFICATION_TOKEN_SECRET',
            ),
            expiresIn,
          },
        );

        // 새 토큰 저장
        await this.dbService.db.insert(userServiceSchema.tokens).values({
          type: userServiceSchema.tokenTypeEnum.enumValues[2],
          userId: existingUser.id,
          value: verificationToken,
          scopes: '',
          expiresAt: new Date(Date.now() + this.parseExpiresIn(expiresIn)),
        });

        // 이메일 재발송
        await this.notificationPublisher.publishUserVerificationEvent(
          existingUser.id,
          existingUser.email,
          existingUser.username,
          verificationToken,
        );

        return {
          message:
            '이전에 가입 시도한 이력이 있습니다. 새로운 인증 링크를 이메일로 발송했습니다.',
        };
      }

      const existsUserId = await this.usersService.findUserByLoginId(
        signUpDto.loginId,
      );
      if (existsUserId) {
        throw new ConflictException('이미 존재하는 아이디입니다.');
      }

      const existingUserByNickname = await this.usersService.findUserByUsername(
        signUpDto.username,
      );

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
          emailConsent,
          smsConsent,
          pushConsent,
        });

        const expiresIn =
          this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRATION') ??
          '15m';

        // 이메일 인증용 토큰 생성
        const verificationToken = this.jwtService.sign(
          { sub: user.id },
          {
            secret: this.configService.get<string>(
              'JWT_VERIFICATION_TOKEN_SECRET',
            ),
            expiresIn,
          },
        );

        // 토큰 저장
        await tx.insert(userServiceSchema.tokens).values({
          type: userServiceSchema.tokenTypeEnum.enumValues[2],
          userId: user.id,
          value: verificationToken,
          scopes: '',
          expiresAt: new Date(Date.now() + this.parseExpiresIn(expiresIn)),
        });

        // 이메일 발송
        await this.notificationPublisher.publishUserVerificationEvent(
          user.id,
          user.email,
          user.username,
          verificationToken,
        );

        return {
          message: '이메일로 인증 링크가 발송되었습니다. 인증을 완료해 주세요.',
        };
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      console.error('회원가입 중 오류:', error);
      throw new InternalServerErrorException(
        '회원가입 중 오류가 발생했습니다.',
      );
    }
  }

  async verifyEmail(
    token: string,
    reply: FastifyReply,
  ): Promise<{ accessToken: string }> {
    try {
      //  토큰 검증
      const verificationToken = await this.dbService.db
        .select({
          token: userServiceSchema.tokens,
          user: userServiceSchema.users,
        })
        .from(userServiceSchema.tokens)
        .innerJoin(
          userServiceSchema.users,
          eq(userServiceSchema.tokens.userId, userServiceSchema.users.id),
        )
        .where(
          and(
            eq(userServiceSchema.tokens.value, token),
            gt(userServiceSchema.tokens.expiresAt, new Date()),
            eq(userServiceSchema.users.isEmailVerified, false),
            eq(userServiceSchema.tokens.isRevoked, false),
            eq(
              userServiceSchema.tokens.type,
              userServiceSchema.tokenTypeEnum.enumValues[2],
            ),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]);

      if (!verificationToken) {
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
      await this.dbService.db
        .delete(userServiceSchema.tokens)
        .where(eq(userServiceSchema.tokens.value, token));

      // 기본 역할 설정을 'user'로 하고 기본권한 부여
      await this.usersService.assignDefaultRoleToUser(
        verificationToken.user.id,
      );

      // access 토큰 발급
      const { accessToken } = await this.getAccessToken(
        verificationToken.user,
        reply,
      );
      await this.setRefreshToken(verificationToken.user.id, reply);

      await this.eventPublisher.publishEvent('USER_CREATED', {
        userId: verificationToken.user.id,
        email: verificationToken.user.email,
        name: verificationToken.user.username,
      });

      return { accessToken };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      console.error('이메일 인증 중 오류:', error);
      throw new InternalServerErrorException(
        '이메일 인증 중 오류가 발생했습니다.',
      );
    }
  }

  // 이메일 재전송
  async resendVerificationEmail(email: string) {
    const user = await this.usersService.findUserByEmail(email);
    if (!user) throw new NotFoundException('존재하지 않는 이메일입니다');

    const expiresIn =
      this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRATION') ?? '15m';

    // 새로운 인증 토큰 생성
    const verificationToken = this.jwtService.sign(
      { sub: user.id },
      {
        secret: this.configService.get<string>('JWT_VERIFICATION_TOKEN_SECRET'),
        expiresIn,
      },
    );

    // 새 토큰 저장
    await this.dbService.db.insert(userServiceSchema.tokens).values({
      type: userServiceSchema.tokenTypeEnum.enumValues[2],
      userId: user.id,
      value: verificationToken,
      scopes: '',
      expiresAt: new Date(Date.now() + this.parseExpiresIn(expiresIn)),
    });

    // 이메일 재발송
    this.notificationPublisher.publishUserVerificationEvent(
      user.id,
      user.email,
      user.username,
      verificationToken,
    );

    return;
  }

  async signIn(
    signInDto: SignInDto,
    reply: FastifyReply,
    redirectTo?: string,
  ): Promise<void | { accessToken: string }> {
    const user = await this.usersService.findUserByLoginId(signInDto.loginId);
    if (!user) throw new UnauthorizedException('존재하지 않는 사용자입니다');

    if (user.deletedAt) {
      throw new UnauthorizedException(
        '휴면 처리된 사용자입니다. 관리자에게 문의해주세요.',
      );
    }

    if (!user.isEmailVerified) {
      throw new UnauthorizedException('이메일 인증이 필요합니다.');
    }

    const isAuth = await bcrypt.compare(signInDto.password, user.password);
    if (!isAuth)
      throw new UnauthorizedException('비밀번호가 일치하지 않습니다');

    await this.setRefreshToken(user.id, reply, signInDto.rememberMe);
    const { accessToken } = await this.getAccessToken(user, reply);

    // 마지막 활동일 업데이트
    await this.lastActivityAtUpdate(user);

    if (redirectTo) {
      const whitelist = [
        'http://localhost:3000',
        process.env.MEDUSA_CALLBACK_URL!,
        process.env.CORS_ORIGIN_DOMAIN!,
      ];

      if (!whitelist.some((url) => redirectTo.startsWith(url))) {
        throw new BadRequestException('Invalid redirect URL');
      }

      const url = new URL(redirectTo);
      url.searchParams.set('token', accessToken);

      return reply.status(302).redirect(url.toString());
    }

    return { accessToken };
  }

  async signInWithSocial(
    socialUser: {
      name: string;
      email: string;
      providerId: string;
    },
    provider: ProviderType,
    reply: FastifyReply,
    tx?: DbTransaction,
  ): Promise<void | { redirectUrl: string }> {
    const processSignIn = async (transaction: DbTransaction) => {
      const existingUser = await this._signInWithSocialWithTransaction(
        socialUser,
        provider,
        reply,
        transaction,
      );

      if (!existingUser) {
        const newUser = await this._signUpWithSocialWithTransaction(
          socialUser,
          provider,
          reply,
          transaction,
        );

        await this.eventPublisher.publishEvent('USER_CREATED', {
          userId: newUser.user.id,
          email: newUser.user.email,
          name: newUser.user.username,
        });

        return newUser;
      }

      return existingUser ?? null;
    };

    if (tx) {
      const result = await processSignIn(tx);
      return reply.status(302).redirect(result.redirectUrl);
    } else {
      return await this.dbService.db.transaction(async (transaction) => {
        const result = await processSignIn(transaction);
        return reply.status(302).redirect(result.redirectUrl);
      });
    }
  }

  private async _signInWithSocialWithTransaction(
    socialUser: {
      name: string;
      email: string;
      providerId: string;
    },
    provider: ProviderType,
    reply: FastifyReply,
    tx: DbTransaction,
  ): Promise<{ redirectUrl: string; user: User } | null> {
    const result: { redirectUrl?: string; user?: User } = {};

    // 소셜 providerId로 기존 identity 조회
    const existingIdentity = await tx
      .select({
        identity: userServiceSchema.userIdentities,
        user: userServiceSchema.users,
      })
      .from(userServiceSchema.userIdentities)
      .innerJoin(
        userServiceSchema.users,
        eq(userServiceSchema.userIdentities.userId, userServiceSchema.users.id),
      )
      .where(
        and(
          eq(userServiceSchema.userIdentities.provider, provider),
          eq(
            userServiceSchema.userIdentities.providerId,
            socialUser.providerId,
          ),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);

    result.redirectUrl = this.getSocialRedirectUrl(provider);
    result.user = existingIdentity?.user;

    if (!existingIdentity) {
      // 소셜 로그인 회원가입 처리
      const newUser = await this._signUpWithSocialWithTransaction(
        socialUser,
        provider,
        reply,
        tx,
      );

      result.user = newUser.user;
      result.redirectUrl = newUser.redirectUrl;
    }

    // 토큰 발급
    await this.setRefreshToken(result.user.id, reply, false, tx);
    await this.getAccessToken(result.user, reply, tx);
    await this.lastActivityAtUpdate(result.user, tx); // 마지막 활동일 업데이트

    return { redirectUrl: result.redirectUrl, user: result.user };
  }

  private async _signUpWithSocialWithTransaction(
    socialUser: {
      name: string;
      email: string;
      providerId: string;
    },
    provider: ProviderType,
    reply: FastifyReply,

    tx: DbTransaction,
  ): Promise<{ redirectUrl: string; user: User }> {
    // 이메일 중복 확인
    const existingUser = await this.usersService.findUserByEmail(
      socialUser.email,
      tx,
    );

    if (existingUser) {
      throw new Error('This email already exists');
    }

    // 새 사용자 생성
    const [newUser] = await tx
      .insert(userServiceSchema.users)
      .values({
        loginId: `${provider}_${socialUser.providerId}`,
        username: socialUser.name,
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

    // 토큰 발급
    await this.setRefreshToken(newUser.id, reply, false, tx);
    await this.getAccessToken(newUser, reply, tx);
    await this.lastActivityAtUpdate(newUser, tx); // 마지막 활동일 업데이트

    const redirectUrl = this.getSocialRedirectUrl(provider);

    return { redirectUrl, user: newUser };
  }

  async signOut(req: FastifyRequest, user: User) {
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.split(' ')[1];

    try {
      if (!accessToken) {
        throw new UnauthorizedException('인증 토큰이 필요합니다.');
      }

      // 토큰과 사용자 ID로 토큰 삭제
      const result = await this.dbService.db
        .delete(userServiceSchema.tokens)
        .where(
          and(
            eq(userServiceSchema.tokens.value, accessToken),
            eq(userServiceSchema.tokens.userId, user.id),
          ),
        )
        .returning();

      return { message: '로그아웃되었습니다.' };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new BadRequestException('로그아웃 처리 중 오류가 발생했습니다.');
    }
  }

  private async getUserScopes(
    userId: string,
    tx?: DbTransaction,
  ): Promise<string[]> {
    const client = this.getClient(tx);

    const userScopes = await client
      .select({
        scopeName: userServiceSchema.scopes.scopeName,
        roleName: userServiceSchema.roles.name,
      })
      .from(userServiceSchema.scopes)
      .innerJoin(
        userServiceSchema.roleScopes,
        eq(
          userServiceSchema.scopes.scopeId,
          userServiceSchema.roleScopes.scopeId,
        ),
      )
      .innerJoin(
        userServiceSchema.roles,
        eq(userServiceSchema.roleScopes.roleId, userServiceSchema.roles.roleId),
      )
      .innerJoin(
        userServiceSchema.userRoleAssignments,
        eq(
          userServiceSchema.roles.roleId,
          userServiceSchema.userRoleAssignments.roleId,
        ),
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

    const uniqueScopes = [
      ...new Set(userScopes.map((scope) => scope.scopeName)),
    ];

    return uniqueScopes;
  }

  private async getAccessToken(
    user: User,
    reply: FastifyReply,
    tx?: DbTransaction,
  ): Promise<{ accessToken: string }> {
    const client = this.getClient(tx);
    const scopes = await this.getUserScopes(user.id, tx);

    if (scopes.length === 0) {
      throw new UnauthorizedException(
        '사용자에게 할당된 권한이 없습니다. 관리자에게 문의해주세요.',
      );
    }

    const payload = {
      sub: user.id,
      scopes,
    };

    const expiresIn =
      this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRATION') ?? '15m';

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_VERIFICATION_TOKEN_SECRET'),
      expiresIn,
    });

    // 기존 액세스 토큰 삭제
    await client
      .delete(userServiceSchema.tokens)
      .where(
        and(
          eq(userServiceSchema.tokens.userId, user.id),
          eq(
            userServiceSchema.tokens.type,
            userServiceSchema.tokenTypeEnum.enumValues[0],
          ),
        ),
      );

    // 새 액세스 토큰 저장
    await client.insert(userServiceSchema.tokens).values({
      type: userServiceSchema.tokenTypeEnum.enumValues[0],
      userId: user.id,
      value: accessToken,
      scopes: scopes.join(','),
      expiresAt: new Date(Date.now() + this.parseExpiresIn(expiresIn)),
    });

    const cookieOptions = {
      path: '/',
      ...(process.env.NODE_ENV === 'production'
        ? {
            domain: process.env.CORS_ORIGIN_DOMAIN,
            sameSite: 'none' as const,
            secure: true,
            httpOnly: true,
          }
        : {}),
    };

    reply.setCookie('accessToken', accessToken, cookieOptions);

    return { accessToken };
  }

  async setRefreshToken(
    userId: string,
    reply: FastifyReply,
    rememberMe: boolean = false,
    tx?: DbTransaction,
  ): Promise<{ refreshToken: string }> {
    const client = this.getClient(tx);

    const scopes = await this.getUserScopes(userId, tx);

    // 자동 로그인 여부에 따라 만료 시간 결정
    const expiresIn = this.getRefreshTokenExpiration(rememberMe);

    const refreshToken = this.jwtService.sign(
      { sub: userId, scopes },
      {
        secret: this.configService.get<string>('JWT_REFRESH'),
        expiresIn,
      },
    );

    const expiresAt = new Date(Date.now() + this.parseExpiresIn(expiresIn));

    // 기존 리프레시 토큰 삭제 후 새로 생성 (기간이 바뀔 수 있으므로)
    await client
      .delete(userServiceSchema.tokens)
      .where(
        and(
          eq(userServiceSchema.tokens.userId, userId),
          eq(
            userServiceSchema.tokens.type,
            userServiceSchema.tokenTypeEnum.enumValues[1],
          ),
        ),
      );

    // 새 리프레시 토큰 저장
    await client.insert(userServiceSchema.tokens).values({
      type: userServiceSchema.tokenTypeEnum.enumValues[1],
      userId,
      value: refreshToken,
      scopes: scopes.join(','),
      expiresAt,
    });

    // 쿠키 설정
    const cookieOptions = {
      path: '/',
      maxAge: this.parseExpiresIn(expiresIn),
      ...(process.env.NODE_ENV === 'production'
        ? {
            domain: process.env.CORS_ORIGIN_DOMAIN,
            sameSite: 'none' as const,
            secure: true,
            httpOnly: true,
          }
        : {}),
    };

    reply.setCookie('refreshToken', refreshToken, cookieOptions);

    return { refreshToken };
  }

  async restoreToken(user: User, reply: FastifyReply) {
    return this.getAccessToken(user, reply);
  }

  async forgetUserId(email: string) {
    const user = await this.usersService.findUserByEmail(email);
    if (!user) throw new NotFoundException('존재하지 않는 이메일입니다');

    // ID 찾기 이벤트 발행
    await this.notificationPublisher.publishUserFindIdEvent(
      email,
      user.loginId,
    );
  }

  async forgotPassword(email: string) {
    const user = await this.usersService.findUserByEmail(email);
    if (!user) throw new NotFoundException('존재하지 않는 이메일입니다');

    const verificationToken = this.jwtService.sign(
      { email },
      {
        secret: this.configService.get('JWT_VERIFICATION_TOKEN_SECRET'),
        expiresIn: `${this.configService.get('JWT_RESET_PASSWORD_ACCESS_TOKEN_EXPIRATION')}`,
      },
    );

    await this.notificationPublisher.publishUserResetPasswordEvent(
      email,
      verificationToken,
    );
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const email = await this.jwtService.verify(token, {
      secret: this.configService.get('JWT_VERIFICATION_TOKEN_SECRET'),
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

  async findValidToken(userId: string, tokenValue: string) {
    const existingToken = await this.dbService.db
      .select()
      .from(userServiceSchema.tokens)
      .where(
        and(
          eq(userServiceSchema.tokens.userId, userId),
          eq(userServiceSchema.tokens.value, tokenValue),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] || null);

    if (
      !existingToken ||
      existingToken.expiresAt <= new Date() ||
      existingToken.isRevoked
    ) {
      throw new UnauthorizedException('Unauthorized');
    }

    return;
  }

  async changePassword(password: string, user: User) {
    const existingUser = await this.usersService.findUserById(user.id);

    if (existingUser?.id !== user.id) {
      throw new UnauthorizedException('Unauthorized');
    }

    try {
      const saltOrRounds = 10;
      const hash = await bcrypt.hash(password, saltOrRounds);
      await this.dbService.db
        .update(userServiceSchema.users)
        .set({ password: hash })
        .where(eq(userServiceSchema.users.id, user.id));

      return;
    } catch (error) {
      throw new InternalServerErrorException(
        '비밀번호 변경 중 오류가 발생했습니다.',
      );
    }
  }

  async checkPassword(password: string, user: User): Promise<void> {
    const isAuth = await bcrypt.compare(password, user.password);
    if (!isAuth)
      throw new UnauthorizedException('비밀번호가 일치하지 않습니다');

    return;
  }

  async deleteAccount(user: User): Promise<void> {
    const deletedUser = await this.dbService.db
      .delete(userServiceSchema.users)
      .where(eq(userServiceSchema.users.id, user.id))
      .returning();

    if (deletedUser.length > 0) {
      await this.eventPublisher.publishEvent('USER_DELETED', {
        userId: user.id,
      });
    } else {
      throw new NotFoundException(
        `User with id ${user.id} not found or already deleted.`,
      );
    }

    return;
  }

  // 리프레시 토큰 만료 시간 결정
  private getRefreshTokenExpiration(rememberMe: boolean): string {
    if (rememberMe) {
      // 자동 로그인 체크 = 90일
      return (
        this.configService.get<string>('JWT_REFRESH_TOKEN_LONG_EXPIRATION') ??
        '90d'
      );
    } else {
      // 일반 로그인 = 2주
      return (
        this.configService.get<string>('JWT_REFRESH_TOKEN_EXPIRATION') ?? '2w'
      );
    }
  }

  // async socialSignUp(socialSignUpDto: SocialSignUpDto, reply: FastifyReply) {
  //   try {
  //     // 이미 가입된 사용자인지 확인
  //     const existingIdentity = await this.dbService.db
  //       .select()
  //       .from(userServiceSchema.userIdentities)
  //       .where(
  //         and(
  //           eq(
  //             userServiceSchema.userIdentities.provider,
  //             socialSignUpDto.provider,
  //           ),
  //           eq(
  //             userServiceSchema.userIdentities.providerId,
  //             socialSignUpDto.providerId,
  //           ),
  //         ),
  //       )
  //       .limit(1)
  //       .then((rows) => rows[0]);

  //     if (existingIdentity) {
  //       throw new ConflictException('이미 가입된 사용자입니다.');
  //     }

  //     // 이메일 중복 확인
  //     const existingUser = await this.usersService.findUserByEmail(
  //       socialSignUpDto.email,
  //     );

  //     if (existingUser) {
  //       throw new ConflictException('이미 사용중인 이메일입니다.');
  //     }

  //     return await this.dbService.db.transaction(async (tx) => {
  //       // 새 사용자 생성
  //       const [newUser] = await tx
  //         .insert(userServiceSchema.users)
  //         .values({
  //           loginId: `${socialSignUpDto.provider}_${socialSignUpDto.providerId}`,
  //           username: socialSignUpDto.username,
  //           email: socialSignUpDto.email,
  //           password: null,
  //           isEmailVerified: true,
  //         })
  //         .returning();

  //       // identity 생성
  //       await tx.insert(userServiceSchema.userIdentities).values({
  //         userId: newUser.id,
  //         provider: socialSignUpDto.provider,
  //         providerId: socialSignUpDto.providerId,
  //         providerData: {
  //           name: socialSignUpDto.username,
  //           email: socialSignUpDto.email,
  //         },
  //       });

  //       // 프로필 생성
  //       if (
  //         socialSignUpDto.phoneNumber ||
  //         socialSignUpDto.address ||
  //         socialSignUpDto.birthDate ||
  //         socialSignUpDto.profileImageUrl
  //       ) {
  //         await tx.insert(userServiceSchema.profiles).values({
  //           userId: newUser.id,
  //           phoneNumber: socialSignUpDto.phoneNumber,
  //           address: socialSignUpDto.address || {},
  //           birthDate: socialSignUpDto.birthDate,
  //           profileImageUrl: socialSignUpDto.profileImageUrl,
  //         });
  //       }

  //       // 기본 역할 설정
  //       const userRole = await tx
  //         .select()
  //         .from(userServiceSchema.roles)
  //         .where(eq(userServiceSchema.roles.name, 'user'))
  //         .limit(1)
  //         .then((rows) => rows[0]);

  //       if (!userRole) {
  //         throw new Error('기본 사용자 역할이 설정되어 있지 않습니다.');
  //       }

  //       await tx.insert(userServiceSchema.userRoleAssignments).values({
  //         userId: newUser.id,
  //         roleId: userRole.roleId,
  //       });

  //       // 토큰 발급
  //       await this.setRefreshToken(newUser.id, reply, false, tx);
  //       await this.getAccessToken(newUser, reply, tx);

  //       await this.consentsService.getUserConsent(newUser.id, tx);

  //       return;
  //     });
  //   } catch (error) {
  //     if (error instanceof ConflictException) {
  //       throw error;
  //     }
  //     console.error('소셜 회원가입 중 오류:', error);
  //     throw new InternalServerErrorException(
  //       '소셜 회원가입 중 오류가 발생했습니다.',
  //     );
  //   }
  // }

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
