import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AUTH_CONFIG } from './constants';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/**
 * Auth Core Module
 * Provides JWT Access Token validation for MSA services
 *
 * @example
 * // In your app.module.ts
 * @Module({
 *   imports: [
 *     ConfigModule.forRoot({ isGlobal: true }),
 *     AuthCoreModule.forRootAsync(),
 *   ],
 * })
 * export class AppModule {}
 */
@Global()
@Module({})
export class AuthCoreModule {
  /**
   * Register module asynchronously with ConfigService
   * Reads AUTH_SECRET and JWT_ISSUER from environment variables
   */
  static forRootAsync(): DynamicModule {
    return {
      module: AuthCoreModule,
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      providers: [
        {
          provide: AUTH_CONFIG,
          useFactory: (configService: ConfigService) => {
            // user-service는 AUTH_SECRET으로 토큰을 생성하므로 동일한 키로 검증
            const secret = configService.get<string>('AUTH_SECRET');
            if (!secret) {
              throw new Error(
                'AUTH_SECRET is not defined in environment variables',
              );
            }
            console.log('🔑 [AuthCoreModule] Using AUTH_SECRET for JWT validation');
            return {
              secret,
              issuer: configService.get<string>(
                'JWT_ISSUER',
                'almondyoung-auth',
              ),
            };
          },
          inject: [ConfigService],
        },
        JwtAccessStrategy,
        JwtAuthGuard,
      ],
      exports: [JwtAuthGuard, JwtAccessStrategy, PassportModule],
    };
  }
}
