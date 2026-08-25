import { Module, DynamicModule, Global, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AuthorizationService } from './services/authorization.service';
import { AuthenticationService } from './services/authentication.service';
import { ScopeBootstrapService, AuthorizationModuleOptions } from './services/scope-bootstrap.service';
import { ScopeGuard } from './guards/scope.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AdminRealmGuard } from './guards/admin-realm.guard';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { AUTHORIZATION_OPTIONS, AUTH_CONFIG } from './constants';

const authConfigProvider: Provider = {
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
};

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
        authConfigProvider,
        AuthenticationService,
        AuthorizationService,
        ScopeBootstrapService,
        ScopeGuard,
        JwtAccessStrategy,
        JwtAuthGuard,
        AdminRealmGuard,
      ],
      exports: [
        AuthenticationService,
        AuthorizationService,
        ScopeGuard,
        JwtAuthGuard,
        AdminRealmGuard,
        JwtAccessStrategy,
        PassportModule,
        AUTHORIZATION_OPTIONS,
      ],
    };
  }

  /**
   * JWT 인증만 등록한다 — DB 가 없는 앱용 (search 등).
   * forRoot 와 달리 DbService 를 요구하는 AuthorizationService/ScopeBootstrapService/
   * ScopeGuard 를 제외하므로 스코프 검사(@RequireScopes)는 쓸 수 없다.
   */
  static forAuthOnly(): DynamicModule {
    return {
      module: AuthorizationModule,
      imports: [ConfigModule, PassportModule.register({ defaultStrategy: 'jwt' })],
      providers: [authConfigProvider, AuthenticationService, JwtAccessStrategy, JwtAuthGuard, AdminRealmGuard],
      exports: [AuthenticationService, JwtAuthGuard, AdminRealmGuard, JwtAccessStrategy, PassportModule],
    };
  }
}
