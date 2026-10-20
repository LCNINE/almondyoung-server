import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import {
  iamPermissions,
  iamRolePermissions,
  roles,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { and, eq, inArray, isNotNull, isNull, notInArray } from 'drizzle-orm';

export type NewIamPermission = typeof iamPermissions.$inferInsert;

export interface PermissionDefinitionRow {
  readonly key: string;
  readonly domain: string;
  readonly label: string;
  readonly description: string;
  readonly dangerous: boolean;
  readonly systemOnly: boolean;
}

@Injectable()
export class IamRepository {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  private client(tx?: UserServiceTx) {
    return tx ?? this.dbService.db;
  }

  async insertMissingPermissions(rows: NewIamPermission[], tx: UserServiceTx): Promise<string[]> {
    if (rows.length === 0) return [];
    const inserted = await tx
      .insert(iamPermissions)
      .values(rows)
      .onConflictDoNothing({ target: iamPermissions.key })
      .returning({ key: iamPermissions.key });
    return inserted.map((row) => row.key);
  }

  async markDeprecated(keys: string[], tx: UserServiceTx): Promise<number> {
    if (keys.length === 0) return 0;
    const rows = await tx
      .update(iamPermissions)
      .set({ deprecatedAt: new Date() })
      .where(and(inArray(iamPermissions.key, keys), isNull(iamPermissions.deprecatedAt)))
      .returning({ key: iamPermissions.key });
    return rows.length;
  }

  async clearDeprecated(keys: string[], tx: UserServiceTx): Promise<number> {
    if (keys.length === 0) return 0;
    const rows = await tx
      .update(iamPermissions)
      .set({ deprecatedAt: null })
      .where(and(inArray(iamPermissions.key, keys), isNotNull(iamPermissions.deprecatedAt)))
      .returning({ key: iamPermissions.key });
    return rows.length;
  }

  findPermissionStates(tx?: UserServiceTx) {
    return this.client(tx)
      .select({ key: iamPermissions.key, deprecatedAt: iamPermissions.deprecatedAt })
      .from(iamPermissions);
  }

  /** 역할 편집 검증용 — 권한마다 위험·시스템 전용·폐기 여부 */
  findPermissionFlags(tx?: UserServiceTx) {
    return this.client(tx)
      .select({
        key: iamPermissions.key,
        dangerous: iamPermissions.dangerous,
        systemOnly: iamPermissions.systemOnly,
        deprecatedAt: iamPermissions.deprecatedAt,
      })
      .from(iamPermissions);
  }

  async findRoleIdsByNames(names: string[], tx: UserServiceTx): Promise<Map<string, string>> {
    if (names.length === 0) return new Map();
    const rows = await tx
      .select({ roleId: roles.roleId, name: roles.name })
      .from(roles)
      .where(inArray(roles.name, names));
    return new Map(rows.map((row) => [row.name, row.roleId]));
  }

  async insertGrants(rows: { roleId: string; permissionKey: string }[], tx: UserServiceTx): Promise<void> {
    if (rows.length === 0) return;
    await tx.insert(iamRolePermissions).values(rows).onConflictDoNothing();
  }

  findPermissionDefinitions(tx: UserServiceTx) {
    return tx
      .select({
        key: iamPermissions.key,
        domain: iamPermissions.domain,
        label: iamPermissions.label,
        description: iamPermissions.description,
        dangerous: iamPermissions.dangerous,
        systemOnly: iamPermissions.systemOnly,
      })
      .from(iamPermissions);
  }

  async updatePermissionDefinition(row: PermissionDefinitionRow, tx: UserServiceTx): Promise<void> {
    await tx
      .update(iamPermissions)
      .set({
        domain: row.domain,
        label: row.label,
        description: row.description,
        dangerous: row.dangerous,
        systemOnly: row.systemOnly,
      })
      .where(eq(iamPermissions.key, row.key));
  }

  findStaffGrants(excludedRoleNames: readonly string[], tx?: UserServiceTx) {
    return this.client(tx)
      .select({
        roleName: roles.name,
        displayName: roles.displayName,
        permissionKey: iamPermissions.key,
      })
      .from(roles)
      .leftJoin(iamRolePermissions, eq(iamRolePermissions.roleId, roles.roleId))
      .leftJoin(
        iamPermissions,
        and(
          eq(iamPermissions.key, iamRolePermissions.permissionKey),
          isNull(iamPermissions.deprecatedAt),
          eq(iamPermissions.systemOnly, false),
        ),
      )
      .where(notInArray(roles.name, [...excludedRoleNames]));
  }

  async findActivePermissionKeys(tx?: UserServiceTx): Promise<string[]> {
    const rows = await this.client(tx)
      .select({ key: iamPermissions.key })
      .from(iamPermissions)
      .where(and(isNull(iamPermissions.deprecatedAt), eq(iamPermissions.systemOnly, false)));
    return rows.map((row) => row.key);
  }

  async findRolesByNames(
    names: string[],
  ): Promise<{ name: string; displayName: string | null; landingPath: string | null; createdAt: Date }[]> {
    if (names.length === 0) return [];
    return this.dbService.db
      .select({
        name: roles.name,
        displayName: roles.displayName,
        landingPath: roles.landingPath,
        createdAt: roles.createdAt,
      })
      .from(roles)
      .where(inArray(roles.name, names));
  }
}
