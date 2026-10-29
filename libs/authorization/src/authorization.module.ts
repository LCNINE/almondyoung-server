import { Module, DynamicModule, Global, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AuthenticationService } from './services/authentication.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { AUTH_CONFIG } from './constants';

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
  /** JWT 인증을 등록한다. 라우트 권한은 PermissionModule 의 PermissionGuard 가 판정한다. */
  static forAuthOnly(): DynamicModule {
    return {
      module: AuthorizationModule,
      imports: [ConfigModule, PassportModule.register({ defaultStrategy: 'jwt' })],
      providers: [authConfigProvider, AuthenticationService, JwtAccessStrategy, JwtAuthGuard],
      exports: [AuthenticationService, JwtAuthGuard, JwtAccessStrategy, PassportModule],
    };
  }
}
