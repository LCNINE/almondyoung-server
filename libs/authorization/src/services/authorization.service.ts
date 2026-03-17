import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, inArray } from 'drizzle-orm';
import { scopes, roleScopeMapping } from '../database/auth.schema';
import { ScopeDefinition, UserWithRoles } from '../database/auth.types';

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
      .innerJoin(scopes, eq(roleScopeMapping.scopeId, scopes.id))
      .where(inArray(roleScopeMapping.roleName, roleNames));

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

  async ensureScopeMapping(roleName: string, scopeKey: string): Promise<void> {
    const [scope] = await this.db
      .select({ id: scopes.id })
      .from(scopes)
      .where(eq(scopes.key, scopeKey));

    if (!scope) {
      throw new Error(`Scope '${scopeKey}' not found`);
    }

    await this.db
      .insert(roleScopeMapping)
      .values({ roleName, scopeId: scope.id })
      .onConflictDoNothing();

    this.invalidateCache();
  }

  async removeScopeMapping(roleName: string, scopeKey: string): Promise<void> {
    const [scope] = await this.db
      .select({ id: scopes.id })
      .from(scopes)
      .where(eq(scopes.key, scopeKey));

    if (!scope) return;

    await this.db
      .delete(roleScopeMapping)
      .where(and(
        eq(roleScopeMapping.roleName, roleName),
        eq(roleScopeMapping.scopeId, scope.id),
      ));

    this.invalidateCache();
  }

  async getScopeMappingsByRole(roleName: string): Promise<string[]> {
    const result = await this.db
      .select({ scopeKey: scopes.key })
      .from(roleScopeMapping)
      .innerJoin(scopes, eq(roleScopeMapping.scopeId, scopes.id))
      .where(eq(roleScopeMapping.roleName, roleName));

    return result.map(r => r.scopeKey);
  }

  /**
   * 사용자가 특정 스코프를 가지고 있는지 확인
   * master 스코프를 가진 경우 항상 true 반환
   */
  async hasScope(user: UserWithRoles, scope: string): Promise<boolean> {
    const userScopes = await this.getScopesByRoles(user.roles);
    return userScopes.has('master') || userScopes.has(scope);
  }

  /**
   * 사용자가 여러 스코프 중 하나라도 가지고 있는지 확인 (OR 조건)
   * master 스코프를 가진 경우 항상 true 반환
   */
  async hasAnyScope(user: UserWithRoles, requiredScopes: string[]): Promise<boolean> {
    if (!requiredScopes || requiredScopes.length === 0) {
      return false;
    }

    const userScopes = await this.getScopesByRoles(user.roles);

    if (userScopes.has('master')) {
      return true;
    }

    return requiredScopes.some(scope => userScopes.has(scope));
  }

  /**
   * 사용자가 모든 스코프를 가지고 있는지 확인 (AND 조건)
   * master 스코프를 가진 경우 항상 true 반환
   */
  async hasAllScopes(user: UserWithRoles, requiredScopes: string[]): Promise<boolean> {
    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    const userScopes = await this.getScopesByRoles(user.roles);

    if (userScopes.has('master')) {
      return true;
    }

    return requiredScopes.every(scope => userScopes.has(scope));
  }

  /**
   * 사용자의 모든 스코프를 배열로 반환 (편의 메소드)
   */
  async getUserScopes(user: UserWithRoles): Promise<string[]> {
    const userScopes = await this.getScopesByRoles(user.roles);
    return Array.from(userScopes);
  }
}
