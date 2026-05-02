import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { INTERNAL_TOKEN_AUDIENCE } from '../../../constants/auth.constant';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    const jwtSecret = configService.get<string>('AUTH_SECRET');
    const issuer = configService.get<string>('OAUTH_ISSUER_URL');

    if (!jwtSecret) {
      throw new Error('AUTH_SECRET 환경 변수가 설정되지 않았습니다. JWT 인증을 위해 이 환경 변수를 설정하세요.');
    }
    if (!issuer) {
      throw new Error('OAUTH_ISSUER_URL 환경 변수가 설정되지 않았습니다.');
    }

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => {
          return req?.cookies?.accessToken;
        },
      ]),
      secretOrKey: jwtSecret,
      ignoreExpiration: false,
      passReqToCallback: true,
      // OAuth 토큰(RS256, aud=client_id)과 구분 + 향후 시크릿 유출 시 RP가 자체 검증 가능하도록.
      algorithms: ['HS256'],
      issuer,
      audience: INTERNAL_TOKEN_AUDIENCE,
    });
  }

  async validate(req: any, payload: { sub: string; email: string; roles: string[]; login_id?: string }) {
    // JWT payload 정보 반환
    return {
      id: payload.sub,
      email: payload.email,
      roles: payload.roles ?? [],
      login_id: payload.login_id,
    };
  }
}
