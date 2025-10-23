import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { TokensService } from '../../tokens/tokens.service';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
    private tokensService: TokensService,
  ) {
    const jwtSecret = configService.get<string>(
      'JWT_VERIFICATION_TOKEN_SECRET',
    );

    if (!jwtSecret) {
      throw new Error(
        'JWT_VERIFICATION_TOKEN_SECRET 환경 변수가 설정되지 않았습니다. JWT 인증을 위해 이 환경 변수를 설정하세요.',
      );
    }

    super({
      // jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req) => {
          return req?.cookies?.accessToken;
        },
      ]),
      secretOrKey: jwtSecret,
      ignoreExpiration: false,
      passReqToCallback: true, // req를 validate 메소드로 전달
    });
  }

  async validate(req: any, payload: { sub: string; scopes: string[] }) {
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
