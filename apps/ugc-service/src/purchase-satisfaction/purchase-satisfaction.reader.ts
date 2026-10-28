import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { and, count, desc, eq, gte, isNotNull, isNull, lt, lte, gt, sql, type SQL } from 'drizzle-orm';
import { purchaseSatisfactions, type UgcServiceSchema, type UgcTx } from '../db/schema';
import type { AdminPurchaseSatisfactionQueryDto } from './dto/admin-purchase-satisfaction-query.dto';
import type { PurchaseSatisfactionSummaryDto } from './dto/admin-purchase-satisfaction-list-response.dto';
import { PURCHASE_SATISFACTION_REASONS, type PurchaseSatisfactionReason, type PurchaseSatisfactionRow } from './types';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 20;

const kstMidnightUtc = (ymd: string): number => {
  const ms = Date.parse(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== ymd) {
    throw new BadRequestError(`Invalid date: ${ymd}`);
  }
  return ms - KST_OFFSET_MS;
};

export function toKstRange(from?: string, to?: string): { gte?: Date; lt?: Date } {
  return {
    gte: from ? new Date(kstMidnightUtc(from)) : undefined,
    lt: to ? new Date(kstMidnightUtc(to) + DAY_MS) : undefined,
  };
}

export type PurchaseSatisfactionPage = { data: PurchaseSatisfactionRow[]; total: number; page: number; limit: number };

@Injectable()
export class PurchaseSatisfactionReader {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  async findByOrderId(orderId: string, tx?: UgcTx): Promise<PurchaseSatisfactionRow> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(purchaseSatisfactions)
        .where(eq(purchaseSatisfactions.orderId, orderId))
        .limit(1);
      if (!row) throw new NotFoundError(`Purchase satisfaction not found: ${orderId}`);
      return row;
    }, tx);
  }

  async list(query: AdminPurchaseSatisfactionQueryDto, tx?: UgcTx): Promise<PurchaseSatisfactionPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const where = and(this.periodWhere(query), ...this.filterWhere(query));
    return this.db.run(async (trx) => {
      const [{ total }] = await trx.select({ total: count() }).from(purchaseSatisfactions).where(where);
      const data = await trx
        .select()
        .from(purchaseSatisfactions)
        .where(where)
        .orderBy(desc(purchaseSatisfactions.updatedAt), desc(purchaseSatisfactions.id))
        .limit(limit)
        .offset((page - 1) * limit);
      return { data, total, page, limit };
    }, tx);
  }

  async summarize(
    query: Pick<AdminPurchaseSatisfactionQueryDto, 'from' | 'to'>,
    tx?: UgcTx,
  ): Promise<PurchaseSatisfactionSummaryDto> {
    const where = this.periodWhere(query);
    const rating = purchaseSatisfactions.rating;
    return this.db.run(async (trx) => {
      const [agg] = await trx
        .select({
          count: count(),
          average: sql<string | null>`avg(${rating})`,
          high: sql<number>`(count(*) filter (where ${rating} >= 4))::int`,
          uncheckedLow: sql<number>`(count(*) filter (where ${rating} <= 3 and ${purchaseSatisfactions.checkedAt} is null))::int`,
          r1: sql<number>`(count(*) filter (where ${rating} = 1))::int`,
          r2: sql<number>`(count(*) filter (where ${rating} = 2))::int`,
          r3: sql<number>`(count(*) filter (where ${rating} = 3))::int`,
          r4: sql<number>`(count(*) filter (where ${rating} = 4))::int`,
          r5: sql<number>`(count(*) filter (where ${rating} = 5))::int`,
        })
        .from(purchaseSatisfactions)
        .where(where);

      const unnested = trx
        .select({ reason: sql<string>`unnest(${purchaseSatisfactions.reasons})`.as('reason') })
        .from(purchaseSatisfactions)
        .where(and(where, lte(purchaseSatisfactions.rating, 3)))
        .as('unnested');
      const reasonRows = await trx
        .select({ reason: unnested.reason, n: sql<number>`count(*)::int` })
        .from(unnested)
        .groupBy(unnested.reason);

      const reasonCounts = Object.fromEntries(PURCHASE_SATISFACTION_REASONS.map((r) => [r, 0])) as Record<
        PurchaseSatisfactionReason,
        number
      >;
      for (const { reason, n } of reasonRows) {
        if (reason in reasonCounts) reasonCounts[reason as PurchaseSatisfactionReason] = n;
      }

      return {
        count: agg.count,
        average: agg.count === 0 ? 0 : Math.round(Number(agg.average) * 10) / 10,
        csatPercent: agg.count === 0 ? 0 : Math.round((agg.high / agg.count) * 100),
        uncheckedLow: agg.uncheckedLow,
        distribution: [agg.r1, agg.r2, agg.r3, agg.r4, agg.r5],
        reasonCounts,
      };
    }, tx);
  }

  private periodWhere(query: Pick<AdminPurchaseSatisfactionQueryDto, 'from' | 'to'>): SQL | undefined {
    const range = toKstRange(query.from, query.to);
    return and(
      range.gte ? gte(purchaseSatisfactions.updatedAt, range.gte) : undefined,
      range.lt ? lt(purchaseSatisfactions.updatedAt, range.lt) : undefined,
    );
  }

  private filterWhere(query: AdminPurchaseSatisfactionQueryDto): (SQL | undefined)[] {
    return [
      query.score === 'low' ? lte(purchaseSatisfactions.rating, 3) : undefined,
      query.score === 'high' ? gt(purchaseSatisfactions.rating, 3) : undefined,
      query.reason ? sql`${query.reason} = any(${purchaseSatisfactions.reasons})` : undefined,
      query.hasMemo ? isNotNull(purchaseSatisfactions.memo) : undefined,
      query.unchecked ? isNull(purchaseSatisfactions.checkedAt) : undefined,
    ];
  }
}
