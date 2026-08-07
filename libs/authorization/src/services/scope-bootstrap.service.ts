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
    // 등록할 스코프도 매핑도 없으면 DB 를 건드리지 않는다. 인증(JWT)과 역할 기반 가드만 쓰는
    // 서비스(notification 등)는 `auth` 스키마가 자기 DB 에 없을 수 있는데, 여기서 무조건
    // `auth.scopes` 를 SELECT 하면 그런 서비스는 부팅 자체가 죽는다.
    const hasScopes = this.options.scopes.length > 0;
    const hasRoleMappings = (this.options.roleMappings?.length ?? 0) > 0;

    if (!hasScopes && !hasRoleMappings) {
      this.logger.log(`No scopes declared for ${this.options.microserviceName} — skipping scope bootstrap`);
      return;
    }

    this.logger.log(`Initializing scopes for ${this.options.microserviceName}...`);
    await this.authService.ensureScopesExist(this.options.microserviceName, this.options.scopes);
    if (this.options.roleMappings) {
      await this.authService.ensureRoleScopeMappings(this.options.roleMappings);
    }
    this.logger.log('Scope initialization complete');
  }
}
