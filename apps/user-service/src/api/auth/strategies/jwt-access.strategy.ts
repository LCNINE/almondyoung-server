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

    // 쿠키에서 토큰 값 추출
    const accessToken = req?.cookies?.accessToken;

    if (!accessToken) {
      throw new UnauthorizedException('token not found');
    }

    // DB에서 토큰 검증 (만료, revoke 체크)
    try {
      await this.tokensService.validateAccessToken(payload.sub, accessToken);
    } catch (error) {
      if (error.message === 'Token not found') {
        throw new UnauthorizedException(
          '로그아웃되었거나 유효하지 않은 토큰입니다.',
        );
      }
      if (error.message === 'Token revoked') {
        throw new UnauthorizedException('무효화된 토큰입니다.');
      }
      if (error.message === 'Token expired') {
        throw new UnauthorizedException('만료된 토큰입니다.');
      }
      throw new UnauthorizedException('토큰 검증에 실패했습니다.');
    }

    // JWT payload 정보 반환
    return {
      ...user,
      sub: payload.sub,
      scopes: payload.scopes,
    };
  }
}
