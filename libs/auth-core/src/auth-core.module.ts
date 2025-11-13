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
   * Register module with direct secret injection (for Railway compatibility)
   * @param options.secret - JWT secret (빌드 시점에 주입)
   */
  static forRootAsync(options?: { secret?: string }): DynamicModule {
    return {
      module: AuthCoreModule,
      imports: [
        ConfigModule,
        PassportModule.register({ defaultStrategy: 'jwt' }),
      ],
      providers: [
        {
          provide: AUTH_CONFIG,
          useFactory: (configService: ConfigService) => {
            // 직접 주입된 secret 우선, 없으면 ConfigService에서 읽기
            const secret =
              options?.secret || configService.get<string>('AUTH_SECRET');
            if (!secret) {
              throw new Error(
                'AUTH_SECRET is not defined in environment variables',
              );
            }
            console.log(
              '🔑 [AuthCoreModule] Using AUTH_SECRET for JWT validation',
            );
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
