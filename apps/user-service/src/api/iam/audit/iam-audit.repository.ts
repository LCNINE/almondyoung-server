import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { iamAuditLogs, type UserServiceSchema, type UserServiceTx } from 'apps/user-service/database/drizzle/schema';
import { and, desc, eq, gte, lt, or, sql, type SQL } from 'drizzle-orm';

export type NewIamAuditLog = typeof iamAuditLogs.$inferInsert;
export type IamAuditLogRow = typeof iamAuditLogs.$inferSelect;
/** 이력 쓰기는 호출한 쪽의 트랜잭션에서만 한다. */
export type AuditTx = Pick<UserServiceTx, 'insert'>;

export interface IamAuditFilter {
  readonly from?: Date;
  readonly to?: Date;
  readonly actorUserId?: string;
  readonly targetType?: 'role' | 'user';
  readonly targetId?: string;
  readonly roleId?: string;
  readonly action?: string;
  readonly before?: { readonly occurredAt: Date; readonly id: string };
}

/** 이력은 쓰고 읽기만 한다 — 고치거나 지우는 경로를 두지 않는다. */
@Injectable()
export class IamAuditRepository {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  async insert(row: NewIamAuditLog, tx: AuditTx): Promise<void> {
    await tx.insert(iamAuditLogs).values(row);
  }

  page(filter: IamAuditFilter, limit: number): Promise<IamAuditLogRow[]> {
    const conditions: (SQL | undefined)[] = [
      filter.from ? gte(iamAuditLogs.occurredAt, filter.from) : undefined,
      filter.to ? lt(iamAuditLogs.occurredAt, filter.to) : undefined,
      filter.actorUserId ? eq(iamAuditLogs.actorUserId, filter.actorUserId) : undefined,
      filter.targetType ? eq(iamAuditLogs.targetType, filter.targetType) : undefined,
      filter.targetId ? eq(iamAuditLogs.targetId, filter.targetId) : undefined,
      filter.action ? eq(iamAuditLogs.action, filter.action) : undefined,
      // 역할 기준: 그 역할 자체의 변경 + 그 역할이 들어가거나 빠진 부여 변경
      filter.roleId
        ? or(
            and(eq(iamAuditLogs.targetType, 'role'), eq(iamAuditLogs.targetId, filter.roleId)),
            sql`${iamAuditLogs.before} @> ${JSON.stringify([{ roleId: filter.roleId }])}::jsonb`,
            sql`${iamAuditLogs.after} @> ${JSON.stringify([{ roleId: filter.roleId }])}::jsonb`,
          )
        : undefined,
      filter.before
        ? or(
            lt(iamAuditLogs.occurredAt, filter.before.occurredAt),
            and(eq(iamAuditLogs.occurredAt, filter.before.occurredAt), lt(iamAuditLogs.id, filter.before.id)),
          )
        : undefined,
    ];
    const present = conditions.filter((c): c is SQL => c !== undefined);
    return this.dbService.db
      .select()
      .from(iamAuditLogs)
      .where(present.length > 0 ? and(...present) : undefined)
      .orderBy(desc(iamAuditLogs.occurredAt), desc(iamAuditLogs.id))
      .limit(limit);
  }
}
