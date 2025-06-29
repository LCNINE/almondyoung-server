import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import * as cookie from 'cookie';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: (req: Request) => {
        const cookies = cookie.parse(req.headers.cookie || '');
        const token = cookies.refreshtoken || cookies.refreshToken || null;

        return token;
      },
      secretOrKey: configService.get<string>('JWT_REFRESH')!,
    });
  }

  validate(payload: { sub: string }) {
    return { id: payload.sub };
  }
}
