import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-kakao';
import { FastifyReply, FastifyRequest } from 'fastify';

@Injectable()
export class JwtKakaoStrategy extends PassportStrategy(Strategy, 'kakao') {
  constructor(private configService: ConfigService) {
    super({
      clientID: configService.get<string>('KAKAO_CLIENT_ID')!,
      clientSecret: configService.get<string>('KAKAO_CLIENT_SECRET')!,
      callbackURL: configService.get<string>('KAKAO_CALLBACK_URL')!,
    });
  }

  validate(accessToken: string, refreshToken: string, profile: Profile) {
    return {
      name: profile.displayName,
      email: profile._json.kakao_account.email,
      providerId: profile.id,
    };
  }
}
