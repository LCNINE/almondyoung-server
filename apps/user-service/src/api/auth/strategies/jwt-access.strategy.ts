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
    const publicKey = configService.get<string>('OAUTH_JWT_PUBLIC_KEY');
    const issuer = configService.get<string>('OAUTH_ISSUER_URL');

    if (!publicKey) {
      throw new Error('OAUTH_JWT_PUBLIC_KEY 환경 변수가 설정되지 않았습니다.');
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
      // 내부 토큰은 OAuth와 동일한 RS256 키페어로 서명. RP는 JWKS로 공개키만 가져와 verify 가능.
      secretOrKey: publicKey,
      algorithms: ['RS256'],
      ignoreExpiration: false,
      passReqToCallback: true,
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
