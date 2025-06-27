import { DynamicModule, Module } from '@nestjs/common';
import { AUTH_INSTANCE_KEY } from '../constants/auth.constant';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserModule } from '../user/user.module';
import { BetterAuthService } from './better-auth.service';
import { ConfigService } from '@nestjs/config';
import { auth } from './better-auth.config';

@Module({
  imports: [UserModule],
  controllers: [AuthController],
  providers: [AuthService, BetterAuthService],
  exports: [AuthService, BetterAuthService],
})
export class AuthModule {
  static forRootAsync(): DynamicModule {
    return {
      global: true,
      module: AuthModule,
      providers: [
        {
          provide: AUTH_INSTANCE_KEY,
          useFactory: async (configService: ConfigService) => {
            return auth;
          },
          inject: [ConfigService],
        },
      ],
      exports: [AUTH_INSTANCE_KEY],
    };
  }
}
