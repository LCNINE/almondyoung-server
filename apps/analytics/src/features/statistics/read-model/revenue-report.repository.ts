import { BadRequestError, ConflictError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, desc, eq, gt, gte, lt, lte, sql } from 'drizzle-orm';
import {
  aggChannelDaily,
  analyticsSchema,
  externalRevenueMonthly,
  externalRevenueHistory,
  factOrderItems,
} from '../../../schema';
import { seoulDayStart } from '../../../shared/date.util';
import type { ExternalRevenueRowDto } from '../api/revenue-report.controller';

@Injectable()
export class RevenueReportRepository {
  constructor(@InjectTypedDb<typeof analyticsSchema>() private readonly database: DbService<typeof analyticsSchema>) {}

  async get(year: number, includeHistory = true) {
    const [daily, external, history] = await Promise.all([
      this.database.db
        .select({
          date: aggChannelDaily.aggDate,
          channel: aggChannelDaily.salesChannel,
          orders: aggChannelDaily.ordersCount,
          gross: aggChannelDaily.grossRevenue,
          cancelled: aggChannelDaily.cancelledAmount,
          refunded: aggChannelDaily.refundedAmount,
        })
        .from(aggChannelDaily)
        .where(and(gte(aggChannelDaily.aggDate, `${year}-01-01`), lte(aggChannelDaily.aggDate, `${year}-12-31`)))
        .orderBy(asc(aggChannelDaily.aggDate), asc(aggChannelDaily.salesChannel)),
      this.database.db
        .select()
        .from(externalRevenueMonthly)
        .where(and(gte(externalRevenueMonthly.month, `${year}-01`), lte(externalRevenueMonthly.month, `${year}-12`)))
        .orderBy(asc(externalRevenueMonthly.month), asc(externalRevenueMonthly.channel)),
      includeHistory ? this.history(year) : Promise.resolve([]),
    ]);

    return { history, year, extractedAt: new Date().toISOString(), daily, external };
  }

  history(year: number) {
    return this.database.db
      .select()
      .from(externalRevenueHistory)
      .where(
        sql`exists (select 1 from jsonb_array_elements(${externalRevenueHistory.after}) r where r->>'month' between ${`${year}-01`} and ${`${year}-12`})`,
      )
      .orderBy(desc(externalRevenueHistory.recordedAt))
      .limit(50);
  }

  async import(rows: ExternalRevenueRowDto[], recordedBy?: string, batchId?: string) {
    return this.database.run(async (tx) => {
      // Serialize imports so the retained before-image matches the replaced values.
      await tx.execute(sql`set local lock_timeout = '5s'`);
      await tx.execute(sql`set local statement_timeout = '15s'`);
      await tx.execute(sql`select pg_advisory_xact_lock(724358, 1)`);
      const values = rows.map(({ expectedUpdatedAt: _expected, ...row }) => row);
      if (batchId) {
        const [previous] = await tx
          .select({
            same: sql<boolean>`${externalRevenueHistory.after} = ${JSON.stringify(values)}::jsonb`,
            recordedBy: externalRevenueHistory.recordedBy,
          })
          .from(externalRevenueHistory)
          .where(eq(externalRevenueHistory.id, batchId));
        if (previous) {
          if (!previous.same || previous.recordedBy !== (recordedBy ?? null))
            throw new ConflictError('같은 반영 요청의 내용이 달라졌습니다. 파일을 다시 불러와 주세요.');
          return { imported: rows.length, replayed: true };
        }
      }
      const before = await tx
        .select()
        .from(externalRevenueMonthly)
        .where(
          sql`(${externalRevenueMonthly.channel}, ${externalRevenueMonthly.account}, ${externalRevenueMonthly.month}, ${externalRevenueMonthly.basis}) in (${sql.join(
            rows.map((row) => sql`(${row.channel}, ${row.account}, ${row.month}, ${row.basis})`),
            sql`, `,
          )})`,
        );
      const key = (row: ExternalRevenueRowDto) => JSON.stringify([row.channel, row.account, row.month, row.basis]);
      const keys = new Set(values.map(key));
      const current = new Map(before.map((row) => [key(row), row]));
      for (const row of rows) {
        const old = current.get(key(row));
        if (row.expectedUpdatedAt !== undefined && (old?.updatedAt.toISOString() ?? null) !== row.expectedUpdatedAt)
          throw new ConflictError('다른 사용자가 자료를 변경했습니다. 새로고침 후 교체 내용을 다시 확인해 주세요.');
        const changed = old && (old.amount !== row.amount || old.source !== row.source);
        if (
          changed &&
          [row.originalStatus, row.monthlyStatus, row.duplicateStatus, row.settlementStatus].includes('confirmed') &&
          old.reviewNote === row.reviewNote
        )
          throw new BadRequestError('금액·출처 변경 후 확인 상태를 유지하려면 대조메모에 새 확인 근거를 적어 주세요.');
      }
      await tx
        .insert(externalRevenueHistory)
        .values({ id: batchId, recordedBy, before: before.filter((row) => keys.has(key(row))), after: values });
      await tx
        .insert(externalRevenueMonthly)
        .values(values)
        .onConflictDoUpdate({
          target: [
            externalRevenueMonthly.channel,
            externalRevenueMonthly.account,
            externalRevenueMonthly.month,
            externalRevenueMonthly.basis,
          ],
          set: {
            amount: sql`excluded.amount`,
            source: sql`excluded.source`,
            updatedAt: new Date(),
            originalStatus: sql`excluded.original_status`,
            monthlyStatus: sql`excluded.monthly_status`,
            duplicateStatus: sql`excluded.duplicate_status`,
            settlementStatus: sql`excluded.settlement_status`,
            reviewNote: sql`excluded.review_note`,
          },
        });
      return { imported: rows.length, replayed: false };
    });
  }

  async raw(year: number, page: number, after?: string, through?: string) {
    const period = and(
      gte(factOrderItems.occurredAt, seoulDayStart(`${year}-01-01`)),
      lt(factOrderItems.occurredAt, seoulDayStart(`${year + 1}-01-01`)),
    );
    if (!through) {
      const [last] = await this.database.db
        .select({ id: factOrderItems.id })
        .from(factOrderItems)
        .where(period)
        .orderBy(desc(factOrderItems.id))
        .limit(1);
      through = last?.id;
      if (!through) return { rows: [], hasMore: false, next: null, through: null };
    }
    const limit = 1000;
    const rows = await this.database.db
      .select({
        id: factOrderItems.id,
        occurredAt: factOrderItems.occurredAt,
        channel: factOrderItems.salesChannel,
        orderKey: factOrderItems.orderKey,
        orderId: factOrderItems.orderId,
        externalOrderId: factOrderItems.externalOrderId,
        orderItemId: factOrderItems.orderItemId,
        productName: factOrderItems.productName,
        quantity: factOrderItems.quantity,
        unitPrice: factOrderItems.unitPrice,
        totalPrice: factOrderItems.totalPrice,
        currency: factOrderItems.currency,
      })
      .from(factOrderItems)
      .where(and(period, lte(factOrderItems.id, through), after ? gt(factOrderItems.id, after) : undefined))
      .orderBy(asc(factOrderItems.id))
      .limit(limit + 1)
      .offset(after ? 0 : page * limit);

    return {
      rows: rows.slice(0, limit),
      hasMore: rows.length > limit,
      next: rows[Math.min(rows.length, limit) - 1]?.id ?? null,
      through,
    };
  }
}
