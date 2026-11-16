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
  /** 이번에 준 첫 부여 몫 — 배포 뒤 첫 부팅에 무엇이 들어갔는지 로그로 남긴다 */
  granted: { permissionKey: string; roleName: string }[];
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

/** 동기화가 읽는 카탈로그 모양. 역할 이름은 문자열로 받는다 — 테스트가 실제 역할과 겹치지 않는 이름을 쓰게. */
export type SyncablePermission = Omit<PermissionDefinition, 'grantOnFirstRegistration'> & {
  readonly grantOnFirstRegistration: readonly string[];
};

/**
 * 첫 부여는 (키, 역할)마다 한 번이다. 첫 등록 때 없던 역할도 생긴 뒤 다음 부팅에 받고,
 * 준 기록(iam_initial_grant_deliveries)이 회수된 몫을 되살리지 않게 한다(#1248).
 */
@Injectable()
export class PermissionCatalogSyncManager {
  constructor(
    private readonly repository: IamRepository,
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  sync(
    catalog: readonly SyncablePermission[] = PERMISSION_CATALOG,
    options: { scopePrefix?: string } = {},
  ): Promise<CatalogSyncResult> {
    return this.dbService.run((tx) => this.syncIn(catalog, options.scopePrefix, tx));
  }

  private async syncIn(
    catalog: readonly SyncablePermission[],
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

    const { granted, missingRoles } = await this.grantUndeliveredShares(catalog, tx);
    const relabeled = await this.relabel(definitions, tx);

    return { inserted, deprecated, restored, grants: granted.length, granted, missingRoles, relabeled };
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

  private async grantUndeliveredShares(
    catalog: readonly SyncablePermission[],
    tx: UserServiceTx,
  ): Promise<{ granted: { permissionKey: string; roleName: string }[]; missingRoles: string[] }> {
    const wanted = [...new Set(catalog.flatMap((p) => p.grantOnFirstRegistration))];
    if (wanted.length === 0) return { granted: [], missingRoles: [] };
    const roleIds = await this.repository.findRoleIdsByNames(wanted, tx);
    const roleNames = new Map([...roleIds].map(([name, id]) => [id, name]));

    const deliveredRows = await this.repository.findDeliveredShares(
      catalog.map((p) => p.key),
      tx,
    );
    const delivered = new Set(deliveredRows.map(shareId));
    const undelivered = catalog.flatMap((p) =>
      p.grantOnFirstRegistration
        .map((role) => roleIds.get(role))
        .filter((roleId): roleId is string => roleId !== undefined)
        .map((roleId) => ({ roleId, permissionKey: p.key }))
        .filter((share) => !delivered.has(shareId(share))),
    );
    const missingRoles = wanted.filter((role) => !roleIds.has(role));
    if (undelivered.length === 0) return { granted: [], missingRoles };
    // 기록을 먼저 넣고 새로 들어간 몫만 부여한다 — 두 인스턴스가 함께 부팅해도 한 몫은 한 번이다
    const recorded = await this.repository.insertDeliveries(undelivered, tx);
    await this.repository.insertGrants(recorded, tx);

    return {
      granted: recorded.map((share) => ({
        permissionKey: share.permissionKey,
        roleName: roleNames.get(share.roleId) ?? '',
      })),
      missingRoles,
    };
  }
}

const shareId = (share: { roleId: string; permissionKey: string }) => `${share.permissionKey}\u0000${share.roleId}`;
