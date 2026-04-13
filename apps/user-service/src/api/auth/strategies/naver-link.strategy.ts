import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-naver-v2';

/**
 * 네이버 계정 연결용 Passport Strategy
 * 기존 JwtNaverStrategy와 다른 callbackURL을 사용
 */
@Injectable()
export class NaverLinkStrategy extends PassportStrategy(Strategy, 'naver-link') {
  constructor(private configService: ConfigService) {
    const clientID = configService.get<string>('NAVER_CLIENT_ID');
    const clientSecret = configService.get<string>('NAVER_CLIENT_SECRET');
    const callbackURL = configService.get<string>('NAVER_LINK_CALLBACK_URL');

    if (!clientID || !clientSecret || !callbackURL) {
      throw new Error(
        'Naver Link OAuth 환경 변수가 설정되지 않았습니다. NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, NAVER_LINK_CALLBACK_URL을 설정하세요.',
      );
    }

    super({
      clientID,
      clientSecret,
      callbackURL,
      passReqToCallback: true,
    });
  }

  validate(
    req: any,
    accessToken: string,
    refreshToken: string,
    profile: Profile,
  ): { name: string; email: string; providerId: string; state: string } {
    const state = req.query?.state ?? '';

    return {
      name: profile.name ?? '',
      email: profile.email ?? '',
      providerId: profile.id,
      state,
    };
  }
}
