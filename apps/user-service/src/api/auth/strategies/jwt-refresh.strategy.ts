import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { FastifyRequest } from 'fastify';
import { Strategy } from 'passport-jwt';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(
    private configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: (req: FastifyRequest) => {
        return req.cookies?.refreshToken || null;
      },
      secretOrKey: configService.get<string>('JWT_REFRESH')!,
      passReqToCallback: true,
    });
  }

  async validate(req: FastifyRequest, payload: { sub: string }) {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('refresh token이 없습니다.');
    }

    await this.authService.findValidToken(payload.sub, refreshToken);

    return { id: payload.sub };
  }
}
