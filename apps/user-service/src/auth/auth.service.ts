import { DbService, InjectDb } from '@app/db';
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import * as schema from '../../database/drizzle/schema';
import { UserService } from '../user/user.service';
import { BetterAuthService } from './better-auth.service';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    @InjectDb() private readonly dbService: DbService<schema.UserSchema>,
    private readonly betterAuthService: BetterAuthService,
  ) {}

  async signUp(signUpDto: SignUpDto) {
    const existsEmail = await this.validateUniqueEmail(signUpDto.email);
    if (existsEmail) {
      throw new BadRequestException('이미 존재하는 이메일입니다.');
    }

    // const existsUserId = await this.validateUniqueUserId(signUpDto.userId);
    // if (existsUserId) {
    //   throw new BadRequestException('이미 존재하는 아이디입니다.');
    // }

    const { user: authUser } = await this.betterAuthService.api.signUpEmail({
      body: {
        email: signUpDto.email,
        password: signUpDto.password,
        name: signUpDto.username,
      },
    });

    console.log('authUser:', authUser);

    const [updatedUser] = await this.dbService.db
      .update(schema.users)
      .set({ id: authUser.id })
      .where(eq(schema.users.id, authUser.id))
      .returning();

    return '완료';
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
      await this.betterAuthService.api.signOut({
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

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

  async refreshToken(request: FastifyRequest) {
    const cookieToken = request.cookies?.auth;
    const bearerToken = request.headers.authorization?.replace('Bearer ', '');

    const token = cookieToken || bearerToken;

    if (!token) {
      throw new UnauthorizedException('인증 토큰이 필요합니다.');
    }

    try {
      const response = await this.betterAuthService.api.refreshToken({
        body: {
          providerId: token,
        },
      });

      return {
        token: response.accessToken,
      };
    } catch (error) {
      throw new UnauthorizedException('토큰 갱신에 실패했습니다.');
    }
  }

  async validateUniqueEmail(email: string) {
    const users = await this.dbService.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    return users.length > 0 ? users[0] : null;
  }

  async validateUniqueUserId(userId: string) {
    // const users = await this.dbService.db
    //   .select()
    //   .from(schema.users)
    //   .where(eq(schema.users.userId, userId))
    //   .limit(1);
    // return users.length > 0 ? users[0] : null;
  }
}
