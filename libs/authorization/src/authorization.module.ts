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
            const secret = configService.get<string>('AUTH_SECRET');
            if (!secret) {
              throw new Error('AUTH_SECRET is not defined in environment variables');
            }
            return {
              secret,
              issuer: configService.get<string>('JWT_ISSUER', 'almondyoung-auth'),
              audience: configService.get<string>('JWT_AUDIENCE', 'almondyoung'),
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
