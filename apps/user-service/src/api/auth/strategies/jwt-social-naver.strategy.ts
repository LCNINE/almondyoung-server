import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-naver-v2';

@Injectable()
export class JwtNaverStrategy extends PassportStrategy(Strategy, 'naver') {
  constructor(private configService: ConfigService) {
    const clientID = configService.get<string>('NAVER_CLIENT_ID');
    const clientSecret = configService.get<string>('NAVER_CLIENT_SECRET');
    const callbackURL = configService.get<string>('NAVER_CALLBACK_URL');

    if (!clientID || !clientSecret || !callbackURL) {
      throw new Error(
        'Naver OAuth 환경 변수가 설정되지 않았습니다. NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, NAVER_CALLBACK_URL을 설정하세요.',
      );
    }
    super({
      clientID,
      clientSecret,
      callbackURL,
    });
  }

  validate(accessToken: string, refreshToken: string, profile: Profile) {
    return {
      name: profile.name,
      email: profile.email,
      providerId: profile.id,
    };
  }
}