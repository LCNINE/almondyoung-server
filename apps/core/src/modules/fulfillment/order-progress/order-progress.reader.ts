import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, lt, sql, SQL } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { decodeCursor, encodeCursor } from './order-progress.cursor';
import { judgedRowsSql } from './order-progress.judge-sql';
import { OrderProgressSummary, assembleSummary } from './order-progress.summary';
import {
  ORDER_PROGRESS_STAGES,
  OrderProgressOutcome,
  OrderProgressStage,
  isStuck,
  stuckCutoff,
} from './order-progress.thresholds';

export type JudgedRow = {
  salesOrderId: string;
  salesChannel: string;
  stage: OrderProgressStage | null;
  state: string | null;
  outcome: OrderProgressOutcome | null;
  estimatedEnteredAt: string;
};

type RawJudged = {
  sales_order_id: string;
  sales_channel: string;
  stage: OrderProgressStage | null;
  state: string | null;
  outcome: OrderProgressOutcome | null;
  estimated_entered_at: string;
};

export type ListQuery = {
  stage: OrderProgressStage;
  state?: string;
  stuck?: boolean;
  channel?: string;
  sort: 'dwell' | 'ordered';
  limit: number;
  cursor?: string;
};
export type OrderProgressItem = {
  salesOrderId: string;
  orderNo: string;
  channelOrderId: string;
  salesChannel: string;
  customerName: string | null;
  orderedAt: string;
  state: string | null;
  stageEnteredAt: string;
  stuck: boolean;
};
export type OrderProgressPage = { items: OrderProgressItem[]; nextCursor: string | null };

const isoOf = (expr: SQL) => sql<string | null>`to_char((${expr}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

@Injectable()
export class OrderProgressReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** 지정한 판매주문들을 판정한다. 투영에 쓰지 않는다 — 리컨실러·스펙이 «지금 판정»을 볼 때 쓴다. */
  async judge(salesOrderIds: string[], now: Date, tx?: DbTx): Promise<JudgedRow[]> {
    if (salesOrderIds.length === 0) return [];
    return this.dbService.run(async (trx) => {
      const scope = sql`SELECT unnest(ARRAY[${sql.join(
        salesOrderIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}])`;
      const result = await trx.execute(judgedRowsSql(scope, now.toISOString()));
      // execute() 원시 결과 타이핑 — demand-series.writer.ts 와 같은 문서화된 캐스트.
      return (result as unknown as RawJudged[]).map((r) => ({
        salesOrderId: r.sales_order_id,
        salesChannel: r.sales_channel,
        stage: r.stage,
        state: r.state,
        outcome: r.outcome,
        estimatedEnteredAt: r.estimated_entered_at,
      }));
    }, tx);
  }

  async summary(now: Date, tx?: DbTx): Promise<OrderProgressSummary> {
    const t = wmsTables.orderProgress;
    // 단계별 갇힘 기준선을 CASE 하나로 — 기준은 thresholds 한 곳에서만 온다
    const cutoff = sql`CASE ${t.stage} ${sql.join(
      ORDER_PROGRESS_STAGES.map((s) => sql`WHEN ${s} THEN ${stuckCutoff(s, now).toISOString()}::timestamptz`),
      sql` `,
    )} ELSE ${now.toISOString()}::timestamptz END`;
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({
          stage: sql<string>`coalesce(${t.stage}, 'unclassified')`,
          state: sql<string>`coalesce(${t.state}, '')`,
          open: sql<number>`count(*)::int`,
          stuck: sql<number>`(count(*) FILTER (WHERE ${t.stageEnteredAt} < ${cutoff}))::int`,
          oldest: isoOf(sql`min(${t.stageEnteredAt})`),
        })
        .from(t)
        .where(isNull(t.outcome))
        .groupBy(t.stage, t.state);
      const [ev] = await trx.select({ at: isoOf(sql`max(${t.evaluatedAt})`) }).from(t);
      return assembleSummary(rows, ev?.at ?? null);
    }, tx);
  }

  async listOrders(query: ListQuery, now: Date, tx?: DbTx): Promise<OrderProgressPage> {
    const t = wmsTables.orderProgress;
    const so = wmsTables.salesOrders;
    const conds: SQL[] = [isNull(t.outcome), eq(t.stage, query.stage)];
    if (query.state) conds.push(eq(t.state, query.state));
    if (query.channel) conds.push(sql`${t.salesChannel}::text = ${query.channel}`);
    if (query.stuck === true) conds.push(lt(t.stageEnteredAt, stuckCutoff(query.stage, now)));
    if (query.stuck === false)
      conds.push(sql`${t.stageEnteredAt} >= ${stuckCutoff(query.stage, now).toISOString()}::timestamptz`);
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      conds.push(
        query.sort === 'dwell'
          ? sql`(${t.stageEnteredAt}, ${t.salesOrderId}) > (${c.at.toISOString()}::timestamptz, ${c.id}::uuid)`
          : sql`(${t.orderedAt}, ${t.salesOrderId}) < (${c.at.toISOString()}::timestamptz, ${c.id}::uuid)`,
      );
    }
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({
          salesOrderId: t.salesOrderId,
          salesChannel: t.salesChannel,
          orderedAt: t.orderedAt,
          state: t.state,
          stageEnteredAt: t.stageEnteredAt,
          displayOrderNo: so.displayOrderNo,
          channelOrderId: so.channelOrderId,
          customerName: so.customerName,
        })
        .from(t)
        .innerJoin(so, eq(so.id, t.salesOrderId))
        .where(and(...conds))
        .orderBy(
          ...(query.sort === 'dwell'
            ? [asc(t.stageEnteredAt), asc(t.salesOrderId)]
            : [desc(t.orderedAt), desc(t.salesOrderId)]),
        )
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => ({
          salesOrderId: r.salesOrderId,
          orderNo: r.displayOrderNo ?? r.channelOrderId,
          channelOrderId: r.channelOrderId,
          salesChannel: r.salesChannel,
          customerName: r.customerName ?? null,
          orderedAt: r.orderedAt.toISOString(),
          state: r.state ?? null,
          stageEnteredAt: r.stageEnteredAt.toISOString(),
          stuck: isStuck(query.stage, r.stageEnteredAt, now),
        })),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor(query.sort === 'dwell' ? last.stageEnteredAt : last.orderedAt, last.salesOrderId)
            : null,
      };
    }, tx);
  }
}
