import { Injectable, UnauthorizedException } from '@nestjs/common';
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
      if (error.message === 'Refresh token not found') {
        throw new UnauthorizedException(
          '로그아웃되었거나 유효하지 않은 리프레시 토큰입니다.',
        );
      }
      if (error.message === 'Refresh token revoked') {
        throw new UnauthorizedException('무효화된 리프레시 토큰입니다.');
      }
      if (error.message === 'Refresh token expired') {
        throw new UnauthorizedException('만료된 리프레시 토큰입니다.');
      }
      throw new UnauthorizedException('리프레시 토큰 검증에 실패했습니다.');
    }

    const user = await this.usersService.findUserById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }

    return {
      ...user,
      sub: payload.sub,
      scopes: payload.scopes,
    };
  }
}
