import { Inject, Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { scopes, roleScopeMapping } from '../database/auth.schema';
import { ScopeDefinition, UserWithRoles } from '../database/auth.types';
import { AUTHORIZATION_OPTIONS } from '../constants';
import type { AuthorizationModuleOptions, RoleScopeMappingDefinition } from './scope-bootstrap.service';

@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);
  private scopeCache = new Map<string, Set<string>>();

  constructor(
    private readonly dbService: DbService,
    @Inject(AUTHORIZATION_OPTIONS) private readonly options: AuthorizationModuleOptions,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async getScopesByRoles(roleNames: string[]): Promise<Set<string>> {
    if (!roleNames || roleNames.length === 0) {
      return new Set();
    }

    // When a service declares authoritative role mappings, unregistered JWT
    // role names must not inherit a stale/ad-hoc database mapping.
    const configuredRoles = this.options.roleMappings
      ? new Map(this.options.roleMappings.map((mapping) => [mapping.roleName, new Set(mapping.scopeKeys)]))
      : undefined;
    const acceptedRoleNames = configuredRoles
      ? [...new Set(roleNames.filter((roleName) => configuredRoles.has(roleName)))]
      : [...new Set(roleNames)];

    if (acceptedRoleNames.length === 0) {
      return new Set();
    }

    const cacheKey = acceptedRoleNames.sort().join(',');

    if (this.scopeCache.has(cacheKey)) {
      return this.scopeCache.get(cacheKey)!;
    }

    const result = await this.db
      .select({ scopeKey: scopes.key })
      .from(roleScopeMapping)
      .innerJoin(scopes, eq(roleScopeMapping.scopeId, scopes.id))
      .where(inArray(roleScopeMapping.roleName, acceptedRoleNames));

    const allowedScopeKeys = configuredRoles
      ? new Set(acceptedRoleNames.flatMap((roleName) => [...configuredRoles.get(roleName)!]))
      : undefined;
    const scopeSet = new Set(
      result.map((row) => row.scopeKey).filter((scopeKey) => !allowedScopeKeys || allowedScopeKeys.has(scopeKey)),
    );
    this.scopeCache.set(cacheKey, scopeSet);

    return scopeSet;
  }

  invalidateCache() {
    this.scopeCache.clear();
    this.logger.log('Authorization cache invalidated');
  }

  async ensureScopesExist(microserviceName: string, scopeDefs: ScopeDefinition[]) {
    const existingScopes = await this.db.select().from(scopes).where(eq(scopes.microserviceName, microserviceName));

    const existingKeys = new Set(existingScopes.map((s) => s.key));
    const newScopes = scopeDefs.filter((def) => !existingKeys.has(def.key));

    if (newScopes.length > 0) {
      await this.db.insert(scopes).values(
        newScopes.map((def) => ({
          key: def.key,
          category: def.category,
          description: def.description,
          microserviceName,
        })),
      );
      this.logger.log(`Registered ${newScopes.length} new scopes for ${microserviceName}`);
    }
  }

  /**
   * Reconcile configured mappings to their exact scope sets.
   *
   * Scope bootstrap calls this only after every scope has been inserted. The
   * reconciliation is transactional so a missing scope or partial write can
   * never leave a role with an incomplete permission set.
   */
  async ensureRoleScopeMappings(roleMappings: RoleScopeMappingDefinition[]): Promise<void> {
    const roleNames = roleMappings.map((mapping) => mapping.roleName);
    if (new Set(roleNames).size !== roleNames.length) {
      throw new Error('Duplicate role names are not allowed in authorization roleMappings');
    }

    const desiredScopeKeys = [...new Set(roleMappings.flatMap((mapping) => mapping.scopeKeys))];
    const scopeRows =
      desiredScopeKeys.length > 0
        ? await this.db
            .select({ id: scopes.id, key: scopes.key })
            .from(scopes)
            .where(inArray(scopes.key, desiredScopeKeys))
        : [];
    const scopeIdByKey = new Map(scopeRows.map((scope) => [scope.key, scope.id]));
    const missingScopeKeys = desiredScopeKeys.filter((scopeKey) => !scopeIdByKey.has(scopeKey));

    if (missingScopeKeys.length > 0) {
      throw new Error(`Scopes not found for role mappings: ${missingScopeKeys.join(', ')}`);
    }

    await this.db.transaction(async (tx) => {
      for (const mapping of roleMappings) {
        const scopeIds = [...new Set(mapping.scopeKeys)].map((scopeKey) => scopeIdByKey.get(scopeKey)!);

        if (scopeIds.length === 0) {
          await tx.delete(roleScopeMapping).where(eq(roleScopeMapping.roleName, mapping.roleName));
          continue;
        }

        await tx
          .delete(roleScopeMapping)
          .where(and(eq(roleScopeMapping.roleName, mapping.roleName), notInArray(roleScopeMapping.scopeId, scopeIds)));
        await tx
          .insert(roleScopeMapping)
          .values(scopeIds.map((scopeId) => ({ roleName: mapping.roleName, scopeId })))
          .onConflictDoNothing();
      }
    });

    this.invalidateCache();
  }

  async ensureScopeMapping(roleName: string, scopeKey: string): Promise<void> {
    const [scope] = await this.db.select({ id: scopes.id }).from(scopes).where(eq(scopes.key, scopeKey));

    if (!scope) {
      throw new Error(`Scope '${scopeKey}' not found`);
    }

    await this.db.insert(roleScopeMapping).values({ roleName, scopeId: scope.id }).onConflictDoNothing();

    this.invalidateCache();
  }

  async removeScopeMapping(roleName: string, scopeKey: string): Promise<void> {
    const [scope] = await this.db.select({ id: scopes.id }).from(scopes).where(eq(scopes.key, scopeKey));

    if (!scope) return;

    await this.db
      .delete(roleScopeMapping)
      .where(and(eq(roleScopeMapping.roleName, roleName), eq(roleScopeMapping.scopeId, scope.id)));

    this.invalidateCache();
  }

  async getScopeMappingsByRole(roleName: string): Promise<string[]> {
    const result = await this.db
      .select({ scopeKey: scopes.key })
      .from(roleScopeMapping)
      .innerJoin(scopes, eq(roleScopeMapping.scopeId, scopes.id))
      .where(eq(roleScopeMapping.roleName, roleName));

    return result.map((r) => r.scopeKey);
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

    return requiredScopes.some((scope) => userScopes.has(scope));
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

    return requiredScopes.every((scope) => userScopes.has(scope));
  }

  /**
   * 사용자의 모든 스코프를 배열로 반환 (편의 메소드)
   */
  async getUserScopes(user: UserWithRoles): Promise<string[]> {
    const userScopes = await this.getScopesByRoles(user.roles);
    return Array.from(userScopes);
  }
}
