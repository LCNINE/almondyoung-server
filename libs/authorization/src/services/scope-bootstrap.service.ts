import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { AUTHORIZATION_OPTIONS } from '../constants';
import { ScopeDefinition } from '../database/auth.types';

export interface AuthorizationModuleOptions {
  microserviceName: string;
  scopes: ScopeDefinition[];
  /**
   * Authoritative role-name to scope mappings owned by this service.
   *
   * Role definitions and user assignments remain in user-service. The
   * authorization library only persists the mapping from a JWT role name to
   * this service's scopes.
   */
  roleMappings?: RoleScopeMappingDefinition[];
}

export interface RoleScopeMappingDefinition {
  roleName: string;
  scopeKeys: string[];
}

@Injectable()
export class ScopeBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ScopeBootstrapService.name);

  constructor(
    @Inject(AUTHORIZATION_OPTIONS) private options: AuthorizationModuleOptions,
    private authService: AuthorizationService,
  ) {}

  async onModuleInit() {
    this.logger.log(`Initializing scopes for ${this.options.microserviceName}...`);
    await this.authService.ensureScopesExist(this.options.microserviceName, this.options.scopes);
    if (this.options.roleMappings) {
      await this.authService.ensureRoleScopeMappings(this.options.roleMappings);
    }
    this.logger.log('Scope initialization complete');
  }
}
