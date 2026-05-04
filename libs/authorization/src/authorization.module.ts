import { Module, DynamicModule, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AuthorizationService } from './services/authorization.service';
import { AuthenticationService } from './services/authentication.service';
import { ScopeBootstrapService, AuthorizationModuleOptions } from './services/scope-bootstrap.service';
import { ScopeGuard } from './guards/scope.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { AUTHORIZATION_OPTIONS, AUTH_CONFIG } from './constants';

@Global()
@Module({})
export class AuthorizationModule {
  /**
   * Register module with JWT authentication and authorization
   * @param options - Authorization module options
   */
  static forRoot(options: AuthorizationModuleOptions): DynamicModule {
    return {
      module: AuthorizationModule,
      imports: [ConfigModule, PassportModule.register({ defaultStrategy: 'jwt' })],
      providers: [
        {
          provide: AUTHORIZATION_OPTIONS,
          useValue: options,
        },
        {
          provide: AUTH_CONFIG,
          useFactory: (configService: ConfigService) => {
            // dual-mode 지원:
            //   - HS256 (legacy): AUTH_SECRET
            //   - RS256/OIDC: OIDC_ISSUER_URL → ${OIDC_ISSUER_URL}/.well-known/jwks.json
            // 둘 중 하나는 반드시 있어야 한다.
            const secret = configService.get<string>('AUTH_SECRET');
            const issuerUrl = configService.get<string>('OIDC_ISSUER_URL');
            const allowedAud = configService.get<string>('ALLOWED_AUDIENCES');

            if (!secret && !issuerUrl) {
              throw new Error(
                'Either AUTH_SECRET (HS256) or OIDC_ISSUER_URL (RS256) must be defined in environment variables',
              );
            }

            const normalizedIssuer = issuerUrl?.replace(/\/$/, '');

            return {
              secret,
              issuer: configService.get<string>('JWT_ISSUER', 'almondyoung-auth'),
              audience: configService.get<string>('JWT_AUDIENCE', 'almondyoung'),
              jwksUri: normalizedIssuer ? `${normalizedIssuer}/.well-known/jwks.json` : undefined,
              oidcIssuer: normalizedIssuer,
              allowedAudiences: allowedAud
                ? allowedAud
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [],
            };
          },
          inject: [ConfigService],
        },
        AuthenticationService,
        AuthorizationService,
        ScopeBootstrapService,
        ScopeGuard,
        JwtAccessStrategy,
        JwtAuthGuard,
      ],
      exports: [
        AuthenticationService,
        AuthorizationService,
        ScopeGuard,
        JwtAuthGuard,
        JwtAccessStrategy,
        PassportModule,
        AUTHORIZATION_OPTIONS,
      ],
    };
  }
}
