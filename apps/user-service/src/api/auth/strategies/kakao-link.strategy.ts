import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-kakao';

/**
 * 카카오 계정 연결용 Passport Strategy
 * 기존 JwtKakaoStrategy와 다른 callbackURL을 사용
 */
@Injectable()
export class KakaoLinkStrategy extends PassportStrategy(Strategy, 'kakao-link') {
  constructor(private configService: ConfigService) {
    const clientID = configService.get<string>('KAKAO_CLIENT_ID');
    const clientSecret = configService.get<string>('KAKAO_CLIENT_SECRET');
    const callbackURL = configService.get<string>('KAKAO_LINK_CALLBACK_URL');

    if (!clientID || !clientSecret || !callbackURL) {
      throw new Error(
        'Kakao Link OAuth 환경 변수가 설정되지 않았습니다. KAKAO_CLIENT_ID, KAKAO_CLIENT_SECRET, KAKAO_LINK_CALLBACK_URL을 설정하세요.',
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
      name: profile.displayName,
      email: profile._json?.kakao_account?.email ?? '',
      providerId: String(profile.id),
      state,
    };
  }
}
