import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConsentsModule } from '../consents/consents.module';
import { Cafe24LinkModule } from '../cafe24-link/cafe24-link.module';
import { OAuthModule } from '../oauth/oauth.module';
import { TokensModule } from '../tokens/tokens.module';
import { UsersModule } from '../users/users.module';
import { AccountLinkingController } from './account-linking.controller';
import { AccountLinkingService } from './account-linking.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { JwtKakaoStrategy } from './strategies/jwt-social-kakao.strategy';
import { JwtNaverStrategy } from './strategies/jwt-social-naver.strategy';
import { KakaoLinkStrategy } from './strategies/kakao-link.strategy';
import { NaverLinkStrategy } from './strategies/naver-link.strategy';

@Module({})
export class AuthModule {
  static register(): DynamicModule {
    // 환경 변수 확인 (빌드 타임)
    const kakaoClientId = process.env.KAKAO_CLIENT_ID;
    const kakaoClientSecret = process.env.KAKAO_CLIENT_SECRET;
    const kakaoCallbackUrl = process.env.KAKAO_CALLBACK_URL;
    const kakaoLinkCallbackUrl = process.env.KAKAO_LINK_CALLBACK_URL;

    const naverClientId = process.env.NAVER_CLIENT_ID;
    const naverClientSecret = process.env.NAVER_CLIENT_SECRET;
    const naverCallbackUrl = process.env.NAVER_CALLBACK_URL;
    const naverLinkCallbackUrl = process.env.NAVER_LINK_CALLBACK_URL;

    const hasKakaoConfig = kakaoClientId && kakaoClientSecret && kakaoCallbackUrl;
    const hasKakaoLinkConfig = kakaoClientId && kakaoClientSecret && kakaoLinkCallbackUrl;

    const hasNaverConfig = naverClientId && naverClientSecret && naverCallbackUrl;
    const hasNaverLinkConfig = naverClientId && naverClientSecret && naverLinkCallbackUrl;

    const hasCafe24Config = !!process.env.CAFE24_SERVICE_KEY;

    if (hasKakaoConfig) {
      console.log('✅ Kakao OAuth Strategy 활성화');
    } else {
      console.warn('⚠️  Kakao OAuth 환경 변수가 설정되지 않아 Kakao 로그인이 비활성화됩니다.');
    }

    if (hasKakaoLinkConfig) {
      console.log('✅ Kakao Link Strategy 활성화');
    } else {
      console.warn('⚠️  KAKAO_LINK_CALLBACK_URL이 설정되지 않아 Kakao 계정 연결이 비활성화됩니다.');
    }

    if (hasNaverConfig) {
      console.log('✅ Naver OAuth Strategy 활성화');
    } else {
      console.warn('⚠️  Naver OAuth 환경 변수가 설정되지 않아 Naver 로그인이 비활성화됩니다.');
    }

    if (hasNaverLinkConfig) {
      console.log('✅ Naver Link Strategy 활성화');
    } else {
      console.warn('⚠️  NAVER_LINK_CALLBACK_URL이 설정되지 않아 Naver 계정 연결이 비활성화됩니다.');
    }

    const providers: Provider[] = [AuthService, AccountLinkingService, JwtAccessStrategy, JwtRefreshStrategy];
    const controllers: Type[] = [AuthController];

    // Kakao 설정이 있을 때만 Strategy 추가
    if (hasKakaoConfig) {
      providers.push(JwtKakaoStrategy);
    }

    // Kakao Link 설정이 있을 때만 Strategy 추가
    if (hasKakaoLinkConfig) {
      providers.push(KakaoLinkStrategy);
      if (!controllers.includes(AccountLinkingController)) {
        controllers.push(AccountLinkingController);
      }
    }

    // Naver 설정이 있을 때만 Strategy 추가
    if (hasNaverConfig) {
      providers.push(JwtNaverStrategy);
    }

    // Naver Link 설정이 있을 때만 Strategy 추가
    if (hasNaverLinkConfig) {
      providers.push(NaverLinkStrategy);
      if (!controllers.includes(AccountLinkingController)) {
        controllers.push(AccountLinkingController);
      }
    }

    return {
      module: AuthModule,
      imports: [
        ConfigModule,
        UsersModule,
        TokensModule,
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.registerAsync({
          imports: [ConfigModule],
          useFactory: async (configService: ConfigService) => ({
            secret: configService.get('JWT_VERIFICATION_TOKEN_SECRET'),
            signOptions: {
              expiresIn: configService.get('JWT_ACCESS_TOKEN_EXPIRATION', '15m'),
            },
          }),
          inject: [ConfigService],
        }),
        DbModule,
        EventsModule,
        ConsentsModule,
        OAuthModule,
        ...(hasCafe24Config ? [Cafe24LinkModule] : []),
      ],
      providers,
      controllers,
      exports: [AuthService, AccountLinkingService, JwtModule, PassportModule],
    };
  }
}
