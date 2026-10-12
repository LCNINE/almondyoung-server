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

  findRolesByNames(names: string[]) {
    if (names.length === 0) return Promise.resolve([]);
    return this.dbService.db
      .select({ name: roles.name, displayName: roles.displayName })
      .from(roles)
      .where(inArray(roles.name, names));
  }
}
