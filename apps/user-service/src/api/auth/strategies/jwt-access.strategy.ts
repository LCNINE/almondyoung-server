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
    super({
      // jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req) => {
          return req?.cookies?.accessToken;
        },
      ]),
      secretOrKey: configService.get<string>('JWT_VERIFICATION_TOKEN_SECRET')!,
      ignoreExpiration: false,
    });
  }

  async validate(payload: { sub: string; scopes: string[] }) {
    const user = await this.usersService.findUserById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }

    // JWT payload 정보 반환
    return {
      ...user,
      sub: payload.sub,
      scopes: payload.scopes,
    };
  }
}
