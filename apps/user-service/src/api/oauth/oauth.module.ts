import { DbModule } from '@app/db';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TokensModule } from '../tokens/tokens.module';
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
    TokensModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        privateKey: config.getOrThrow<string>('OAUTH_JWT_PRIVATE_KEY'),
        publicKey: config.getOrThrow<string>('OAUTH_JWT_PUBLIC_KEY'),
        signOptions: {
          algorithm: 'RS256',
          issuer: config.getOrThrow<string>('OAUTH_ISSUER_URL'),
          keyid: config.getOrThrow<string>('OAUTH_JWT_KID'),
        },
        verifyOptions: {
          algorithms: ['RS256'],
          issuer: config.getOrThrow<string>('OAUTH_ISSUER_URL'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [OAuthController],
  providers: [OAuthService, OAuthManager, OAuthReader, OAuthRepository],
  exports: [OAuthRepository],
})
export class OAuthModule {}
