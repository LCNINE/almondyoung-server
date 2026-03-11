import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    const jwtSecret = configService.get<string>('AUTH_SECRET');

    if (!jwtSecret) {
      throw new Error(
        'AUTH_SECRET 환경 변수가 설정되지 않았습니다. JWT 인증을 위해 이 환경 변수를 설정하세요.',
      );
    }

    super({
      // jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => {
          return req?.cookies?.accessToken;
        },
      ]),
      secretOrKey: jwtSecret,
      ignoreExpiration: false,
      passReqToCallback: true, // req를 validate 메소드로 전달
    });
  }

  async validate(
    req: any,
    payload: { sub: string; email: string; roles: string[]; login_id?: string },
  ) {
    // JWT payload 정보 반환
    return {
      id: payload.sub,
      email: payload.email,
      roles: payload.roles ?? [],
      login_id: payload.login_id,
    };
  }
}
