import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { DynamicModule, Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConsentsModule } from '../consents/consents.module';
import { EventProcessorModule } from '../events/events.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { JwtKakaoStrategy } from './strategies/jwt-social-kakao.strategy';

@Module({})
export class AuthModule {
  static register(): DynamicModule {
    // 환경 변수 확인 (빌드 타임)
    const kakaoClientId = process.env.KAKAO_CLIENT_ID;
    const kakaoClientSecret = process.env.KAKAO_CLIENT_SECRET;
    const kakaoCallbackUrl = process.env.KAKAO_CALLBACK_URL;

    const hasKakaoConfig = kakaoClientId && kakaoClientSecret && kakaoCallbackUrl;

    if (hasKakaoConfig) {
      console.log('✅ Kakao OAuth Strategy 활성화');
    } else {
      console.warn('⚠️  Kakao OAuth 환경 변수가 설정되지 않아 Kakao 로그인이 비활성화됩니다.');
    }

    const providers: Provider[] = [
      AuthService,
      JwtAccessStrategy,
      JwtRefreshStrategy,
    ];

    // Kakao 설정이 있을 때만 Strategy 추가
    if (hasKakaoConfig) {
      providers.push(JwtKakaoStrategy);
    }

    return {
      module: AuthModule,
      imports: [
        ConfigModule,
        UsersModule,
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
        EventProcessorModule,
      ],
      providers,
      controllers: [AuthController],
      exports: [AuthService, JwtModule, PassportModule],
    };
  }
}