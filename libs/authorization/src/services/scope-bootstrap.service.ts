import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { AUTHORIZATION_OPTIONS } from '../constants';
import { ScopeDefinition } from '../database/auth.types';

export interface AuthorizationModuleOptions {
  microserviceName: string;
  scopes: ScopeDefinition[];
}

@Injectable()
export class ScopeBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ScopeBootstrapService.name);

  constructor(
    @Inject(AUTHORIZATION_OPTIONS) private options: AuthorizationModuleOptions,
    private authService: AuthorizationService,
  ) {}

  async onModuleInit() {
    this.logger.log(
      `Initializing scopes for ${this.options.microserviceName}...`,
    );
    await this.authService.ensureScopesExist(
      this.options.microserviceName,
      this.options.scopes,
    );
    this.logger.log('Scope initialization complete');
  }
}
