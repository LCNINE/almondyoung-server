import { DbModule } from '@app/db';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { OAuthController } from './oauth.controller';
import { OAuthManager } from './oauth.manager';
import { OAuthReader } from './oauth.reader';
import { OAuthRepository } from './oauth.repository';
import { OAuthService } from './oauth.service';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('AUTH_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [OAuthController],
  providers: [OAuthService, OAuthManager, OAuthReader, OAuthRepository],
})
export class OAuthModule {}
