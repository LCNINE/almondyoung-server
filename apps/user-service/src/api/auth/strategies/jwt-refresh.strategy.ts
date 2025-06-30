import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { FastifyRequest } from 'fastify';
import { Strategy } from 'passport-jwt';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: (req: FastifyRequest) => {
        return req.cookies?.refreshToken || null;
      },
      secretOrKey: configService.get<string>('JWT_REFRESH')!,
    });
  }

  validate(payload: { sub: string }) {
    return { id: payload.sub };
  }
}
