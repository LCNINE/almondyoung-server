import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JWT_ACCESS_TOKEN_EXPIRATION } from '../../constants/auth.constant';
import { ConsentsModule } from '../consents/consents.module';
import { EventProcessorModule } from '../events/events.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { JwtKakaoStrategy } from './strategies/jwt-social-kakao.strategy';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('AUTH_SECRET'),
        signOptions: {
          expiresIn: JWT_ACCESS_TOKEN_EXPIRATION,
        },
      }),
      inject: [ConfigService],
    }),
    DbModule,
    EventsModule,
    ConsentsModule,
    EventProcessorModule,
  ],
  providers: [
    AuthService,
    JwtAccessStrategy,
    JwtRefreshStrategy,
    JwtKakaoStrategy,
  ],
  controllers: [AuthController],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
