import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, inArray } from 'drizzle-orm';
import { roles, scopes, roleScopeMapping } from '../database/auth.schema';
import { ScopeDefinition } from '../database/auth.types';

@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);
  private scopeCache = new Map<string, Set<string>>();

  constructor(private readonly dbService: DbService) {}

  private get db() {
    return this.dbService.db;
  }

  async getScopesByRoles(roleNames: string[]): Promise<Set<string>> {
    if (!roleNames || roleNames.length === 0) {
      return new Set();
    }

    const cacheKey = [...roleNames].sort().join(',');
    
    if (this.scopeCache.has(cacheKey)) {
      return this.scopeCache.get(cacheKey)!;
    }

    const result = await this.db
      .select({ scopeKey: scopes.key })
      .from(roleScopeMapping)
      .innerJoin(roles, eq(roleScopeMapping.roleId, roles.id))
      .innerJoin(scopes, eq(roleScopeMapping.scopeId, scopes.id))
      .where(inArray(roles.name, roleNames));

    const scopeSet = new Set(result.map(r => r.scopeKey));
    this.scopeCache.set(cacheKey, scopeSet);

    return scopeSet;
  }

  invalidateCache() {
    this.scopeCache.clear();
    this.logger.log('Authorization cache invalidated');
  }

  async ensureScopesExist(microserviceName: string, scopeDefs: ScopeDefinition[]) {
    const existingScopes = await this.db
      .select()
      .from(scopes)
      .where(eq(scopes.microserviceName, microserviceName));

    const existingKeys = new Set(existingScopes.map(s => s.key));
    const newScopes = scopeDefs.filter(def => !existingKeys.has(def.key));

    if (newScopes.length > 0) {
      await this.db.insert(scopes).values(
        newScopes.map(def => ({
          key: def.key,
          category: def.category,
          description: def.description,
          microserviceName,
        }))
      );
      this.logger.log(`Registered ${newScopes.length} new scopes for ${microserviceName}`);
    }
  }
}

