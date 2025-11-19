import { Module, DynamicModule, Global } from '@nestjs/common';
import { AuthorizationService } from './services/authorization.service';
import { ScopeBootstrapService, AuthorizationModuleOptions } from './services/scope-bootstrap.service';
import { ScopeGuard } from './guards/scope.guard';
import { AUTHORIZATION_OPTIONS } from './constants';

@Global()
@Module({})
export class AuthorizationModule {
  static forRoot(options: AuthorizationModuleOptions): DynamicModule {
    return {
      module: AuthorizationModule,
      providers: [
        {
          provide: AUTHORIZATION_OPTIONS,
          useValue: options,
        },
        AuthorizationService,
        ScopeBootstrapService,
        ScopeGuard,
      ],
      exports: [AuthorizationService, ScopeGuard],
    };
  }
}

