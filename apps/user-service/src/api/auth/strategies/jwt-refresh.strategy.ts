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
    super({
      jwtFromRequest: (req: FastifyRequest) => {
        return req.cookies?.refreshToken || null;
      },
      secretOrKey: configService.get<string>('JWT_REFRESH')!,
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
