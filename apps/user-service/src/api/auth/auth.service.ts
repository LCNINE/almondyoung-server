import { DbService, InjectDb } from '@app/db';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import * as schema from '../../../database/drizzle/schema';
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
    @InjectDb() private readonly dbService: DbService<schema.User>,
  ) {}

  async signUp(
    signUpDto: SignUpDto,
    @Res() res: FastifyReply,
  ): Promise<{ accessToken: string }> {
    try {
      const existsEmail = await this.usersService.findUserByEmail(
        signUpDto.email,
      );
      if (existsEmail) {
        throw new ConflictException('이미 존재하는 이메일입니다.');
      }

      const existingUserByNickname = await this.usersService.findUserByUsername(
        signUpDto.username,
      );

      if (existingUserByNickname) {
        throw new ConflictException('이미 존재하는 닉네임입니다.');
      }

      const saltOrRounds = 10;
      const hash = await bcrypt.hash(signUpDto.password, saltOrRounds);

      const [user] = await this.dbService.db
        .insert(schema.users)
        .values({ ...signUpDto, password: hash })
        .returning();

      await this.rolesService.setDefaultRoles(user.id, 'admin'); //todo: mvp구현끝나면 기본 admin역할말고 다른걸로 할당해줘야할듯
      const accessToken = await this.getAccessToken(user, res);
      const refreshToken = await this.setRefreshToken(user.id, res);

      return accessToken;
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      console.error('error:', error);
      throw new InternalServerErrorException(
        '회원가입 중 오류가 발생했습니다.',
      );
    }
  }

  async signIn(
    signInDto: SignInDto,
    res: FastifyReply,
  ): Promise<{ accessToken: string }> {
    const user = await this.usersService.findUserByUserId(signInDto.userId);
    if (!user) throw new UnauthorizedException('존재하지 않는 사용자입니다');

    const isAuth = await bcrypt.compare(signInDto.password, user.password);
    if (!isAuth)
      throw new UnauthorizedException('비밀번호가 일치하지 않습니다');

    await this.setRefreshToken(user.id, res);
    const accessToken = await this.getAccessToken(user, res);

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
      secret: this.configService.get<string>('JWT_SECRET'),
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
  ): Promise<{ refreshToken: string }> {
    const now = new Date();

    // DB에서 기존 refresh token 조회
    const existingToken = await this.dbService.db
      .select({
        value: schema.tokens.value,
        expiresAt: schema.tokens.expiresAt,
      })
      .from(schema.tokens)
      .where(
        and(
          eq(schema.tokens.userId, userId),
          eq(schema.tokens.type, schema.tokenTypeEnum.enumValues[1]),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] || null);

    let refreshToken: string;
    let expiresAt: Date;

    if (!existingToken || new Date(existingToken.expiresAt) <= now) {
      // 없거나 만료됨 → 새 토큰 생성
      const scopes = await this.getUserScopes(userId);
      const expiresIn =
        this.configService.get('JWT_REFRESH_TOKEN_EXPIRATION') ?? '2w';

      refreshToken = this.jwtService.sign(
        { sub: userId, scopes },
        {
          secret: this.configService.get<string>('JWT_REFRESH'),
          expiresIn,
        },
      );

      expiresAt = new Date(Date.now() + this.parseExpiresIn(expiresIn));

      await this.dbService.db
        .insert(schema.tokens)
        .values({
          type: schema.tokenTypeEnum.enumValues[1],
          userId,
          value: refreshToken,
          scopes: scopes.join(','),
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [schema.tokens.userId, schema.tokens.type],
          set: {
            value: refreshToken,
            scopes: scopes.join(','),
            expiresAt,
          },
        });
    } else {
      // 유효한 토큰이면 기존 값 사용
      refreshToken = existingToken.value;
      expiresAt = existingToken.expiresAt;
    }

    // 쿠키 설정
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

    res.setCookie('refreshToken', refreshToken, cookieOptions);

    return { refreshToken };
  }

  async refreshToken(user: schema.User, res: FastifyReply) {
    return this.getAccessToken(user, res);
  }

  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhdw])$/);
    if (!match) return 15 * 60 * 1000; // 기본값 15분

    const [, value, unit] = match;
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
