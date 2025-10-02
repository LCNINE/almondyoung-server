import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { FastifyRequest } from 'fastify';
import { Strategy } from 'passport-jwt';
import { AuthService } from '../auth.service';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(
    private configService: ConfigService,
    private readonly authService: AuthService,
    private usersService: UsersService,
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
      throw new UnauthorizedException('refresh token이 없습니다.');
    }

    await this.authService.findValidToken(payload.sub, refreshToken);

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
