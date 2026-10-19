import { DbService, InjectDb } from '@app/db';
import { PERMISSION_CATALOG, type PermissionDefinition } from '@app/authorization';
import { Injectable } from '@nestjs/common';
import type { UserServiceSchema, UserServiceTx } from 'apps/user-service/database/drizzle/schema';
import { IamRepository, type PermissionDefinitionRow } from './iam.repository';

export interface CatalogSyncResult {
  inserted: string[];
  deprecated: number;
  restored: number;
  grants: number;
  missingRoles: string[];
  /** 이름·설명·표시가 코드와 달라 맞춘 권한 수 */
  relabeled: number;
}

const sameDefinition = (a: PermissionDefinitionRow, b: PermissionDefinitionRow) =>
  a.domain === b.domain &&
  a.label === b.label &&
  a.description === b.description &&
  a.dangerous === b.dangerous &&
  a.systemOnly === b.systemOnly;

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
    const definitions = catalog.map(
      (p): PermissionDefinitionRow => ({
        key: p.key,
        domain: p.key.split('.')[0],
        label: p.label,
        description: p.description,
        dangerous: p.dangerous,
        systemOnly: p.systemOnly,
      }),
    );
    const inserted = await this.repository.insertMissingPermissions([...definitions], tx);

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
    const relabeled = await this.relabel(definitions, tx);

    return { inserted, deprecated, restored, grants, missingRoles, relabeled };
  }

  /** 목록의 원본은 코드다 — 이름·설명·위험 표시가 바뀌면 DB 도 따라간다(부여는 건드리지 않는다). */
  private async relabel(definitions: readonly PermissionDefinitionRow[], tx: UserServiceTx): Promise<number> {
    const stored = new Map((await this.repository.findPermissionDefinitions(tx)).map((row) => [row.key, row]));
    let relabeled = 0;
    for (const definition of definitions) {
      const row = stored.get(definition.key);
      if (!row || sameDefinition(row, definition)) continue;
      await this.repository.updatePermissionDefinition(definition, tx);
      relabeled += 1;
    }
    return relabeled;
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
