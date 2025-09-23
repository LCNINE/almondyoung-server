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
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.get<string>('JWT_VERIFICATION_TOKEN_SECRET')!,
      ignoreExpiration: false,
    });
  }

  async validate(payload: { sub: string; scopes: string[] }) {
    const user = await this.usersService.findUserById(payload.sub);

    if (!user) {
      throw new UnauthorizedException();
    }

    // JWT payload 정보 반환
    return {
      ...user,
      sub: payload.sub,
      scopes: payload.scopes,
    };
  }
}
