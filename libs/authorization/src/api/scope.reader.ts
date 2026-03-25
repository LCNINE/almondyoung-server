import { Injectable, Inject } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and } from 'drizzle-orm';
import { scopes, roleScopeMapping } from '../database/auth.schema';
import { AUTHORIZATION_OPTIONS } from '../constants';
import { AuthorizationModuleOptions } from '../services/scope-bootstrap.service';

@Injectable()
export class ScopeReader {
  constructor(
    private readonly dbService: DbService,
    @Inject(AUTHORIZATION_OPTIONS) private readonly options: AuthorizationModuleOptions,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async getAllScopes() {
    return this.db
      .select()
      .from(scopes)
      .where(eq(scopes.microserviceName, this.options.microserviceName))
      .orderBy(scopes.category, scopes.key);
  }

  async getScopesByRole(roleName: string): Promise<string[]> {
    const result = await this.db
      .select({ scopeKey: scopes.key })
      .from(roleScopeMapping)
      .innerJoin(scopes, eq(roleScopeMapping.scopeId, scopes.id))
      .where(and(eq(roleScopeMapping.roleName, roleName), eq(scopes.microserviceName, this.options.microserviceName)));

    return result.map((r) => r.scopeKey);
  }
}
