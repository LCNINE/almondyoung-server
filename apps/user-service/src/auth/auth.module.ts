import { DynamicModule, Module } from '@nestjs/common';
import { AUTH_INSTANCE_KEY } from '../constants/auth.constant';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserModule } from '../user/user.module';
import { DbModule } from '@app/db';
import { BetterAuthService } from './better-auth.service';
import { ConfigService } from '@nestjs/config';
import { betterAuth } from 'better-auth';
import { auth } from './better-auth.config';

@Module({
  imports: [UserModule, DbModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {
  static forRootAsync(): DynamicModule {
    return {
      global: true,
      module: AuthModule,
      providers: [
        {
          provide: AUTH_INSTANCE_KEY,
          useFactory: async (
            configService: ConfigService,
            authService: AuthService,
          ) => {
            return auth;
          },
          inject: [ConfigService, AuthService],
        },
        BetterAuthService,
      ],
      exports: [AUTH_INSTANCE_KEY, BetterAuthService],
    };
  }
}
