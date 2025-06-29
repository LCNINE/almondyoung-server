import { DbService, InjectDb } from '@app/db';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest, FastifyReply } from 'fastify';
import * as schema from '../../database/drizzle/schema';
import { UsersService } from '../users/users.service';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectDb() private readonly dbService: DbService<schema.User>,
  ) {}

  async signUp(signUpDto: SignUpDto, @Res() res: FastifyReply) {
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

      const accessToken = await this.getAccessToken(user, res);
      this.setRefreshToken(user.id, res);

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

  async signIn(signInDto: SignInDto) {
    // const user = await this.dbService.db
    //   .select()
    //   .from(schema.users)
    //   .where(eq(schema.users.userId, signInDto.userId))
    //   .limit(1);
    // if (!user[0]) {
    //   throw new BadRequestException('존재하지 않는 사용자입니다.');
    // }
    // const { token } = await this.betterAuthService.api.signInEmail({
    //   body: {
    //     email: user[0].email,
    //     password: signInDto.password,
    //   },
    // });
    // return {
    //   user: user[0],
    //   token,
    // };
  }

  async signOut(request: FastifyRequest, id: string) {
    if (!id) {
      throw new BadRequestException('사용자 ID가 필요합니다.');
    }

    const cookieToken = request.cookies?.auth;
    const bearerToken = request.headers.authorization?.replace('Bearer ', '');

    const token = cookieToken || bearerToken;

    if (!token) {
      throw new UnauthorizedException('인증 토큰이 필요합니다.');
    }

    try {
      // 토큰과 사용자 ID로 토큰 삭제
      const result = await this.dbService.db
        .delete(schema.tokens)
        .where(
          and(eq(schema.tokens.value, token), eq(schema.tokens.userId, id)),
        )
        .returning();

      // 삭제된 토큰이 없는 경우
      if (!result.length) {
        throw new UnauthorizedException('유효하지 않은 토큰입니다.');
      }

      return { message: '로그아웃되었습니다.' };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new BadRequestException('로그아웃 처리 중 오류가 발생했습니다.');
    }
  }

  async getAccessToken(
    user: schema.User,
    res: FastifyReply,
  ): Promise<{ accessToken: string }> {
    const payload = {
      sub: user.id,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn:
        this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRATION') ?? '15m',
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

  async setRefreshToken(userId: string, res: FastifyReply): Promise<void> {
    const refreshToken = this.jwtService.sign(
      { sub: userId },
      {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn:
          this.configService.get('JWT_REFRESH_TOKEN_EXPIRATION') ?? '2w',
      },
    );

    const setResCookie = {
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

    res.setCookie('refreshToken', refreshToken, setResCookie);
  }

  async refreshToken(request: FastifyRequest) {
    const cookieToken = request.cookies?.auth;
    const bearerToken = request.headers.authorization?.replace('Bearer ', '');

    const token = cookieToken || bearerToken;

    if (!token) {
      throw new UnauthorizedException('인증 토큰이 필요합니다.');
    }

    try {
      return '새로운 토큰 발급';
    } catch (error) {
      throw new UnauthorizedException('토큰 갱신에 실패했습니다.');
    }
  }
}
