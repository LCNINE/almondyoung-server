import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import {
  piiAccessLogs,
  piiAccessReviews,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';

export type NewPiiAccessLog = typeof piiAccessLogs.$inferInsert;
export type PiiAccessLogRow = typeof piiAccessLogs.$inferSelect;
export type NewPiiAccessReview = typeof piiAccessReviews.$inferInsert;
export type PiiAccessReviewRow = typeof piiAccessReviews.$inferSelect;

export interface PiiAccessFilter {
  readonly from?: Date;
  readonly to?: Date;
  readonly actorUserId?: string;
  readonly action?: string;
  readonly subject?: { readonly type: string; readonly id: string };
  readonly before?: { readonly occurredAt: Date; readonly id: string };
}

export interface PiiAccessActorSummary {
  readonly actorUserId: string;
  readonly actorLoginId: string | null;
  readonly accessCount: number;
  readonly subjectTotal: number;
  readonly exportCount: number;
  readonly afterHoursCount: number;
}

/** 접속기록은 쓰고 읽기만 한다 — 고치는 경로가 없고, 지우는 것은 보관 기간 정리뿐이다. */
@Injectable()
export class PiiAccessRepository {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  async insert(row: NewPiiAccessLog): Promise<void> {
    await this.dbService.db.insert(piiAccessLogs).values(row).onConflictDoNothing({ target: piiAccessLogs.eventId });
  }

  page(filter: PiiAccessFilter, limit: number, tx?: UserServiceTx): Promise<PiiAccessLogRow[]> {
    const conditions: (SQL | undefined)[] = [
      filter.from ? gte(piiAccessLogs.occurredAt, filter.from) : undefined,
      filter.to ? lt(piiAccessLogs.occurredAt, filter.to) : undefined,
      filter.actorUserId ? eq(piiAccessLogs.actorUserId, filter.actorUserId) : undefined,
      filter.action ? eq(piiAccessLogs.action, filter.action) : undefined,
      filter.subject ? sql`${piiAccessLogs.subjects} @> ${JSON.stringify([filter.subject])}::jsonb` : undefined,
      filter.before
        ? or(
            lt(piiAccessLogs.occurredAt, filter.before.occurredAt),
            and(eq(piiAccessLogs.occurredAt, filter.before.occurredAt), lt(piiAccessLogs.id, filter.before.id)),
          )
        : undefined,
    ];
    const present = conditions.filter((c): c is SQL => c !== undefined);
    return (tx ?? this.dbService.db)
      .select()
      .from(piiAccessLogs)
      .where(present.length > 0 ? and(...present) : undefined)
      .orderBy(desc(piiAccessLogs.occurredAt), desc(piiAccessLogs.id))
      .limit(limit);
  }

  /** 행위자별 건수 — 점검 화면의 «많이 본 사람»·«업무시간 외» 두 열. 집계는 SQL 에서 끝낸다. */
  async summary(from: Date, to: Date): Promise<PiiAccessActorSummary[]> {
    const kstHour = sql`extract(hour from (${piiAccessLogs.occurredAt} at time zone 'UTC' at time zone 'Asia/Seoul'))`;
    const rows = await this.dbService.db
      .select({
        actorUserId: piiAccessLogs.actorUserId,
        actorLoginId: sql<string | null>`max(${piiAccessLogs.actorLoginId})`,
        accessCount: sql<number>`count(*)::int`,
        subjectTotal: sql<number>`coalesce(sum(${piiAccessLogs.subjectCount}), 0)::int`,
        exportCount: sql<number>`count(*) filter (where ${piiAccessLogs.action} = 'export')::int`,
        afterHoursCount: sql<number>`count(*) filter (where ${kstHour} < 9 or ${kstHour} >= 19)::int`,
      })
      .from(piiAccessLogs)
      .where(and(gte(piiAccessLogs.occurredAt, from), lt(piiAccessLogs.occurredAt, to)))
      .groupBy(piiAccessLogs.actorUserId)
      .orderBy(desc(sql`count(*)`))
      .limit(200);
    return rows;
  }

  /** 기준 시각보다 오래된 행을 최대 batch 개 지운다. 지운 수를 돌려준다. */
  async deleteBefore(cutoff: Date, batch: number): Promise<number> {
    const victims = this.dbService.db
      .select({ id: piiAccessLogs.id })
      .from(piiAccessLogs)
      .where(lt(piiAccessLogs.occurredAt, cutoff))
      .limit(batch);
    const deleted = await this.dbService.db
      .delete(piiAccessLogs)
      .where(inArray(piiAccessLogs.id, victims))
      .returning({ id: piiAccessLogs.id });
    return deleted.length;
  }

  async insertReview(row: NewPiiAccessReview): Promise<PiiAccessReviewRow> {
    const [created] = await this.dbService.db.insert(piiAccessReviews).values(row).returning();
    if (!created) throw new Error('pii_access_reviews insert returned no row');
    return created;
  }

  pageReviews(limit: number): Promise<PiiAccessReviewRow[]> {
    return this.dbService.db
      .select()
      .from(piiAccessReviews)
      .orderBy(desc(piiAccessReviews.reviewedAt), desc(piiAccessReviews.id))
      .limit(limit);
  }
}
