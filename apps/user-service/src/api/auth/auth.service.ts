import { DbService, InjectDb } from '@app/db';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import * as schema from '../../../database/drizzle/schema';
import { EmailService } from '../email/email.service';
import { RolesService } from '../roles/roles.service';
import { UsersService } from '../users/users.service';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly rolesService: RolesService,
    private readonly emailService: EmailService,
    @InjectDb() private readonly dbService: DbService<schema.User>,
  ) {}

  async signUp(
    signUpDto: SignUpDto,
    @Res() res: FastifyReply,
  ): Promise<{ message: string }> {
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
          .delete(schema.tokens)
          .where(
            and(
              eq(schema.tokens.userId, existingUser.id),
              eq(schema.tokens.type, schema.tokenTypeEnum.enumValues[2]),
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
        await this.dbService.db.insert(schema.tokens).values({
          type: schema.tokenTypeEnum.enumValues[2],
          userId: existingUser.id,
          value: verificationToken,
          scopes: '',
          expiresAt: new Date(Date.now() + this.parseExpiresIn(expiresIn)),
        });

        // 이메일 재발송
        await this.emailService.sendVerificationEmail(
          signUpDto.email,
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
          .insert(schema.users)
          .values({
            ...signUpDto,
            password: hash,
            isEmailVerified: false,
          })
          .returning();

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
        await tx.insert(schema.tokens).values({
          type: schema.tokenTypeEnum.enumValues[2],
          userId: user.id,
          value: verificationToken,
          scopes: '',
          expiresAt: new Date(Date.now() + this.parseExpiresIn(expiresIn)),
        });

        // 이메일 발송
        await this.emailService.sendVerificationEmail(
          signUpDto.email,
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
    res: FastifyReply,
  ): Promise<{ accessToken: string }> {
    try {
      //  토큰 검증
      const verificationToken = await this.dbService.db
        .select({
          token: schema.tokens,
          user: schema.users,
        })
        .from(schema.tokens)
        .innerJoin(schema.users, eq(schema.tokens.userId, schema.users.id))
        .where(
          and(
            eq(schema.tokens.value, token),
            gt(schema.tokens.expiresAt, new Date()),
            eq(schema.users.isEmailVerified, false),
            eq(schema.tokens.isRevoked, false),
            eq(schema.tokens.type, schema.tokenTypeEnum.enumValues[2]),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]);

      if (!verificationToken) {
        throw new UnauthorizedException('유효하지 않은 인증 토큰입니다.');
      }

      //  사용자 인증 완료 처리
      await this.dbService.db
        .update(schema.users)
        .set({
          isEmailVerified: true,
        })
        .where(eq(schema.users.id, verificationToken.user.id));

      //  사용된 인증 토큰 삭제
      await this.dbService.db
        .delete(schema.tokens)
        .where(eq(schema.tokens.value, token));

      // 기본 역할 설정
      await this.rolesService.setDefaultRoles(
        verificationToken.user.id,
        'user',
      );

      // access 토큰 발급
      const accessToken = await this.getAccessToken(
        verificationToken.user,
        res,
      );
      await this.setRefreshToken(verificationToken.user.id, res);

      return accessToken;
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
    await this.dbService.db.insert(schema.tokens).values({
      type: schema.tokenTypeEnum.enumValues[2],
      userId: user.id,
      value: verificationToken,
      scopes: '',
      expiresAt: new Date(Date.now() + this.parseExpiresIn(expiresIn)),
    });

    // 이메일 재발송
    await this.emailService.sendVerificationEmail(email, verificationToken);

    return;
  }

  async signIn(
    signInDto: SignInDto,
    res: FastifyReply,
  ): Promise<{ accessToken: string }> {
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

    await this.setRefreshToken(user.id, res, signInDto.rememberMe);
    const accessToken = await this.getAccessToken(user, res);

    await this.dbService.db
      .update(schema.users)
      .set({ lastActivityAt: new Date() })
      .where(eq(schema.users.id, user.id)); // 마지막 활동일 업데이트

    return accessToken;
  }

  async signOut(req: FastifyRequest, user: schema.User) {
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.split(' ')[1];

    try {
      if (!accessToken) {
        throw new UnauthorizedException('인증 토큰이 필요합니다.');
      }

      // 토큰과 사용자 ID로 토큰 삭제
      const result = await this.dbService.db
        .delete(schema.tokens)
        .where(
          and(
            eq(schema.tokens.value, accessToken),
            eq(schema.tokens.userId, user.id),
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

  private async getUserScopes(userId: string): Promise<string[]> {
    const userScopes = await this.dbService.db
      .select({
        scopeName: schema.scopes.scopeName,
      })
      .from(schema.userRoleAssignments)
      .innerJoin(
        schema.roles,
        eq(schema.userRoleAssignments.roleId, schema.roles.roleId),
      )
      .innerJoin(
        schema.roleScopes,
        eq(schema.roles.roleId, schema.roleScopes.roleId),
      )
      .innerJoin(
        schema.scopes,
        eq(schema.roleScopes.scopeId, schema.scopes.scopeId),
      )
      .where(
        and(
          eq(schema.userRoleAssignments.userId, userId),
          or(
            isNull(schema.userRoleAssignments.expiresAt),
            gt(schema.userRoleAssignments.expiresAt, new Date()),
          ),
        ),
      );

    return userScopes.map((scope) => scope.scopeName);
  }

  async getAccessToken(
    user: schema.User,
    res: FastifyReply,
  ): Promise<{ accessToken: string }> {
    const scopes = await this.getUserScopes(user.id);

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

    await this.dbService.db
      .insert(schema.tokens)
      .values({
        type: schema.tokenTypeEnum.enumValues[0],
        userId: user.id,
        value: accessToken,
        scopes: scopes.join(','),
        expiresAt: new Date(Date.now() + this.parseExpiresIn(expiresIn)),
      })
      .onConflictDoUpdate({
        target: [schema.tokens.userId, schema.tokens.type],
        set: {
          value: accessToken,
          scopes: scopes.join(','),
          expiresAt: new Date(Date.now() + this.parseExpiresIn(expiresIn)),
        },
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

    res.setCookie('accessToken', accessToken, cookieOptions);

    return { accessToken };
  }

  async setRefreshToken(
    userId: string,
    res: FastifyReply,
    rememberMe: boolean = false,
  ): Promise<{ refreshToken: string }> {
    const scopes = await this.getUserScopes(userId);

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
    await this.dbService.db
      .delete(schema.tokens)
      .where(
        and(
          eq(schema.tokens.userId, userId),
          eq(schema.tokens.type, schema.tokenTypeEnum.enumValues[1]),
        ),
      );

    // 새 리프레시 토큰 저장
    await this.dbService.db.insert(schema.tokens).values({
      type: schema.tokenTypeEnum.enumValues[1],
      userId,
      value: refreshToken,
      scopes: scopes.join(','),
      expiresAt,
    });

    // 쿠키 설정 (
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

    res.setCookie('refreshToken', refreshToken, cookieOptions);

    return { refreshToken };
  }

  async refreshToken(user: schema.User, res: FastifyReply) {
    return this.getAccessToken(user, res);
  }

  async forgotPassword(email: string) {
    const user = await this.usersService.findUserByEmail(email);
    if (!user) throw new NotFoundException('존재하지 않는 이메일입니다');

    await this.emailService.sendResetPasswordLink(email);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const email = await this.emailService.decodeConfirmationToken(token);

    const user = await this.usersService.findUserByEmail(email);
    if (!user) {
      throw new NotFoundException(`No user found for email: ${email}`);
    }

    const saltOrRounds = 10;
    const hash = await bcrypt.hash(password, saltOrRounds);

    const result = await this.dbService.db
      .update(schema.users)
      .set({ password: hash })
      .where(eq(schema.users.id, user.id));

    return;
  }

  async findValidToken(userId: string, tokenValue: string) {
    const existingToken = await this.dbService.db
      .select()
      .from(schema.tokens)
      .where(
        and(
          eq(schema.tokens.userId, userId),
          eq(schema.tokens.value, tokenValue),
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

  async changePassword(password: string, user: schema.User) {
    const existingUser = await this.usersService.findUserById(user.id);

    if (existingUser?.id !== user.id) {
      throw new UnauthorizedException('Unauthorized');
    }

    try {
      const saltOrRounds = 10;
      const hash = await bcrypt.hash(password, saltOrRounds);
      await this.dbService.db
        .update(schema.users)
        .set({ password: hash })
        .where(eq(schema.users.id, user.id));

      return;
    } catch (error) {
      throw new InternalServerErrorException(
        '비밀번호 변경 중 오류가 발생했습니다.',
      );
    }
  }

  async checkPassword(password: string, user: schema.User): Promise<void> {
    const isAuth = await bcrypt.compare(password, user.password);
    if (!isAuth)
      throw new UnauthorizedException('비밀번호가 일치하지 않습니다');

    return;
  }

  async deleteAccount(user: schema.User): Promise<void> {
    await this.dbService.db
      .delete(schema.users)
      .where(eq(schema.users.id, user.id));
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
