import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { FastifyRequest } from 'fastify';
import { Strategy } from 'passport-jwt';
import { TokensService } from '../../tokens/tokens.service';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
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

  async validate(
    req: FastifyRequest,
    payload: { sub: string; scopes: string[] },
  ) {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException('refresh token not found');
    }

    // DB에서 리프레시 토큰 검증 (만료, revoke 체크)
    try {
      await this.tokensService.validateRefreshToken(payload.sub, refreshToken);
    } catch (error) {
      this.logger.error('리프레시 토큰 검증 실패:', error);
      // await this.tokensService.deleteAllTokens(payload.sub); // 해당 유저의 토큰 다 삭제
      throw new Error('The refresh token is invalid');
    }

    const user = await this.usersService.findUserById(payload.sub);

    if (!user) {
      throw new Error('User not found');
    }

    return {
      ...user,
      sub: payload.sub,
      scopes: payload.scopes,
    };
  }
}
