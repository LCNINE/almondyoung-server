import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { FastifyRequest } from 'fastify';
import { Strategy } from 'passport-jwt';
import { TokensService } from '../../tokens/tokens.service';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  private readonly logger = new Logger(JwtRefreshStrategy.name);

  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
    private tokensService: TokensService,
  ) {
    const refreshSecret = configService.get<string>('JWT_REFRESH_SECRET');

    if (!refreshSecret) {
      throw new Error(
        'JWT_REFRESH_SECRET 환경 변수가 설정되지 않았습니다. JWT Refresh Token을 위해 이 환경 변수를 설정하세요.',
      );
    }

    super({
      jwtFromRequest: (req: FastifyRequest) => {
        return req.cookies?.refreshToken || null;
      },
      secretOrKey: refreshSecret,
      passReqToCallback: true,
      ignoreExpiration: true,
    });
  }

  async validate(req: FastifyRequest, payload: { sub: string; roles: string[] }) {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException('refresh token not found');
    }

    // DB에서 리프레시 토큰 검증 (만료, revoke 체크).
    // 실패는 정상적인 stale 케이스 (다른 클라이언트의 재로그인으로 row overwrite, logout 으로 row 삭제,
    // 자연 만료) 를 모두 포함하므로 ERROR 가 아닌 WARN 으로 남기고, 호출부 (auth-web 등) 가 401 을
    // 받아 비밀번호 재인증 흐름으로 분기할 수 있도록 UnauthorizedException 으로 던진다.
    try {
      await this.tokensService.validateRefreshToken(payload.sub, refreshToken);
    } catch (error) {
      this.logger.warn(`리프레시 토큰 검증 실패 userId=${payload.sub}: ${error instanceof Error ? error.message : error}`);
      throw new UnauthorizedException('refresh token invalid or expired');
    }

    const user = await this.usersService.findUserById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('user not found');
    }

    return {
      ...user,
      id: payload.sub,
      roles: payload.roles ?? [],
    };
  }
}
