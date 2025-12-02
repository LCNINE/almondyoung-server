import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-kakao';
import { FastifyReply, FastifyRequest } from 'fastify';

@Injectable()
export class JwtKakaoStrategy extends PassportStrategy(Strategy, 'kakao') {
  constructor(private configService: ConfigService) {
    const clientID = configService.get<string>('KAKAO_CLIENT_ID');
    const clientSecret = configService.get<string>('KAKAO_CLIENT_SECRET');
    const callbackURL = configService.get<string>('KAKAO_CALLBACK_URL');

    if (!clientID || !clientSecret || !callbackURL) {
      throw new Error(
        'Kakao OAuth 환경 변수가 설정되지 않았습니다. KAKAO_CLIENT_ID, KAKAO_CLIENT_SECRET, KAKAO_CALLBACK_URL을 설정하세요.'
      );
    }

    super({
      clientID,
      clientSecret,
      callbackURL,
    });
  }

  validate(accessToken: string, refreshToken: string, profile: Profile, req: any) {

    console.log('redirect_to::', req.query?.redirect_to);
    return {
      name: profile.displayName,
      email: profile._json.kakao_account.email,
      providerId: profile.id,
      redirectTo: req.query?.redirect_to
    };
  }
}
