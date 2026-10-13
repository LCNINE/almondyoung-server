import { DbService, InjectDb } from '@app/db';
import { PERMISSION_CATALOG, type PermissionDefinition } from '@app/authorization';
import { Injectable } from '@nestjs/common';
import type { UserServiceSchema, UserServiceTx } from 'apps/user-service/database/drizzle/schema';
import { IamRepository } from './iam.repository';

export interface CatalogSyncResult {
  inserted: string[];
  deprecated: number;
  restored: number;
  grants: number;
  missingRoles: string[];
}

@Injectable()
export class PermissionCatalogSyncManager {
  constructor(
    private readonly repository: IamRepository,
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  sync(
    catalog: readonly PermissionDefinition[] = PERMISSION_CATALOG,
    options: { scopePrefix?: string } = {},
  ): Promise<CatalogSyncResult> {
    return this.dbService.run((tx) => this.syncIn(catalog, options.scopePrefix, tx));
  }

  private async syncIn(
    catalog: readonly PermissionDefinition[],
    scopePrefix: string | undefined,
    tx: UserServiceTx,
  ): Promise<CatalogSyncResult> {
    const inserted = await this.repository.insertMissingPermissions(
      catalog.map((p) => ({
        key: p.key,
        domain: p.key.split('.')[0],
        label: p.label,
        description: p.description,
        dangerous: p.dangerous,
        systemOnly: p.systemOnly,
      })),
      tx,
    );

    const catalogKeys = new Set(catalog.map((p) => p.key));
    const allStates = await this.repository.findPermissionStates(tx);
    const states = scopePrefix ? allStates.filter((s) => s.key.startsWith(scopePrefix)) : allStates;
    const deprecated = await this.repository.markDeprecated(
      states.filter((s) => !catalogKeys.has(s.key)).map((s) => s.key),
      tx,
    );
    const restored = await this.repository.clearDeprecated(
      states.filter((s) => catalogKeys.has(s.key) && s.deprecatedAt !== null).map((s) => s.key),
      tx,
    );

    const { grants, missingRoles } = await this.grantFirstRegistrations(catalog, new Set(inserted), tx);

    return { inserted, deprecated, restored, grants, missingRoles };
  }

  private async grantFirstRegistrations(
    catalog: readonly PermissionDefinition[],
    insertedKeys: ReadonlySet<string>,
    tx: UserServiceTx,
  ): Promise<{ grants: number; missingRoles: string[] }> {
    const fresh = catalog.filter((p) => insertedKeys.has(p.key));
    if (fresh.length === 0) return { grants: 0, missingRoles: [] };
    const wanted = [...new Set(fresh.flatMap((p) => p.grantOnFirstRegistration))];
    const roleIds = await this.repository.findRoleIdsByNames(wanted, tx);

    const rows = fresh.flatMap((p) =>
      p.grantOnFirstRegistration
        .map((role) => roleIds.get(role))
        .filter((roleId): roleId is string => roleId !== undefined)
        .map((roleId) => ({ roleId, permissionKey: p.key })),
    );
    await this.repository.insertGrants(rows, tx);

    return { grants: rows.length, missingRoles: wanted.filter((role) => !roleIds.has(role)) };
  }
}
