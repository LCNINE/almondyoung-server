import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DbService, TxFor } from '@app/db';
import { outbox_events } from '@app/events';
import { ORDER_STREAM } from '@packages/event-contracts/streams';
import { channelAdapterSchema, orderCollectionFailures, orderReconcileFindings, wmsOrderMappings } from '../../schema';
import type { FindingHandling, FindingKind, FindingStatus, HumanReason, ReconcileMode } from './order-reconcile.types';

export type AdapterTx = TxFor<typeof channelAdapterSchema>;
export type OrderReconcileFinding = typeof orderReconcileFindings.$inferSelect;

export interface UpsertFindingInput {
  channel: string;
  externalOrderId: string;
  displayOrderNo: string | null;
  kind: FindingKind;
  handling: FindingHandling;
  humanReason: HumanReason | null;
  coreStatus: string | null;
  channelCreatedAt: Date;
  mode: ReconcileMode;
  lastResult: string;
  seenAt: Date;
}

@Injectable()
export class OrderReconcileFindingRepository {
  constructor(private readonly dbService: DbService<typeof channelAdapterSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  async findOpenByOrders(channel: string, externalOrderIds: string[]): Promise<OrderReconcileFinding[]> {
    if (externalOrderIds.length === 0) return [];
    return this.db
      .select()
      .from(orderReconcileFindings)
      .where(
        and(
          eq(orderReconcileFindings.channel, channel),
          eq(orderReconcileFindings.status, 'open'),
          inArray(orderReconcileFindings.externalOrderId, externalOrderIds),
        ),
      );
  }

  async upsertOpen(input: UpsertFindingInput, tx?: AdapterTx): Promise<OrderReconcileFinding> {
    return this.dbService.run(async (trx) => {
      const [row] = await trx
        .insert(orderReconcileFindings)
        .values({
          channel: input.channel,
          externalOrderId: input.externalOrderId,
          displayOrderNo: input.displayOrderNo,
          kind: input.kind,
          handling: input.handling,
          humanReason: input.humanReason,
          coreStatus: input.coreStatus,
          channelCreatedAt: input.channelCreatedAt,
          mode: input.mode,
          lastResult: input.lastResult,
          firstSeenAt: input.seenAt,
          lastSeenAt: input.seenAt,
        })
        .onConflictDoUpdate({
          // 부분 unique 인덱스와 같은 조건이어야 conflict target 으로 잡힌다
          target: [orderReconcileFindings.channel, orderReconcileFindings.externalOrderId, orderReconcileFindings.kind],
          targetWhere: sql`status = 'open'`,
          set: {
            displayOrderNo: input.displayOrderNo,
            handling: input.handling,
            humanReason: input.humanReason,
            coreStatus: input.coreStatus,
            mode: input.mode,
            lastResult: input.lastResult,
            lastSeenAt: input.seenAt,
          },
        })
        .returning();
      if (!row) throw new Error('order_reconcile_findings upsert returned no row');
      return row;
    }, tx);
  }

  async recordAttempt(id: string, lastResult: string, tx?: AdapterTx): Promise<void> {
    await this.dbService.run(async (trx) => {
      await trx
        .update(orderReconcileFindings)
        .set({
          attemptCount: sql`${orderReconcileFindings.attemptCount} + 1`,
          lastAttemptAt: new Date(),
          lastResult: lastResult.slice(0, 200),
        })
        .where(eq(orderReconcileFindings.id, id));
    }, tx);
  }

  async listOpen(channel: string): Promise<OrderReconcileFinding[]> {
    return this.db
      .select()
      .from(orderReconcileFindings)
      .where(and(eq(orderReconcileFindings.channel, channel), eq(orderReconcileFindings.status, 'open')))
      .orderBy(asc(orderReconcileFindings.firstSeenAt));
  }

  async markResolved(ids: string[], at: Date): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.db
      .update(orderReconcileFindings)
      .set({ status: 'resolved', resolvedAt: at })
      .where(and(inArray(orderReconcileFindings.id, ids), eq(orderReconcileFindings.status, 'open')))
      .returning({ id: orderReconcileFindings.id });
    return rows.length;
  }

  async close(id: string, actor: string | null, memo: string): Promise<OrderReconcileFinding | null> {
    const [row] = await this.db
      .update(orderReconcileFindings)
      .set({ status: 'closed', closedAt: new Date(), closedBy: actor, closeMemo: memo })
      .where(and(eq(orderReconcileFindings.id, id), eq(orderReconcileFindings.status, 'open')))
      .returning();
    return row ?? null;
  }

  async findById(id: string): Promise<OrderReconcileFinding | null> {
    const [row] = await this.db.select().from(orderReconcileFindings).where(eq(orderReconcileFindings.id, id));
    return row ?? null;
  }

  async list(options: { status?: FindingStatus; limit: number; offset: number }): Promise<OrderReconcileFinding[]> {
    return this.db
      .select()
      .from(orderReconcileFindings)
      .where(options.status ? eq(orderReconcileFindings.status, options.status) : undefined)
      .orderBy(desc(orderReconcileFindings.lastSeenAt), desc(orderReconcileFindings.id))
      .limit(options.limit)
      .offset(options.offset);
  }

  async summary(): Promise<{ open: number; human: number; gaveUp: number; oldestFirstSeenAt: string | null }> {
    const [row] = await this.db
      .select({
        open: sql<number>`count(*)::int`,
        human: sql<number>`count(*) filter (where ${orderReconcileFindings.handling} = 'human')::int`,
        gaveUp: sql<number>`count(*) filter (where ${orderReconcileFindings.humanReason} = 'attempts_exhausted')::int`,
        oldestFirstSeenAt: sql<
          string | null
        >`to_char(min(${orderReconcileFindings.firstSeenAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      })
      .from(orderReconcileFindings)
      .where(eq(orderReconcileFindings.status, 'open'));
    return {
      open: row?.open ?? 0,
      human: row?.human ?? 0,
      gaveUp: row?.gaveUp ?? 0,
      oldestFirstSeenAt: row?.oldestFirstSeenAt ?? null,
    };
  }

  async mappingsByExternalOrderId(channel: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ channelOrderId: wmsOrderMappings.channelOrderId, wmsOrderId: wmsOrderMappings.wmsOrderId })
      .from(wmsOrderMappings)
      .where(and(eq(wmsOrderMappings.salesChannel, channel), inArray(wmsOrderMappings.channelOrderId, ids)));
    return new Map(rows.map((row) => [row.channelOrderId, row.wmsOrderId]));
  }

  /** 열린 수집 격리는 0단계 격리 칸에 이미 보인다 — 대사가 같은 주문을 또 세지 않는다. */
  async openQuarantineExternalOrderIds(channel: string, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .selectDistinct({ externalOrderId: orderCollectionFailures.externalOrderId })
      .from(orderCollectionFailures)
      .where(
        and(
          eq(orderCollectionFailures.channel, channel),
          eq(orderCollectionFailures.status, 'quarantined'),
          inArray(orderCollectionFailures.externalOrderId, ids),
        ),
      );
    return new Set(rows.map((row) => row.externalOrderId));
  }

  /** 7·8번이 같은 주문(`aggregate_id`)의 뒤 이벤트를 보류한다 — 굳은 행이 있으면 다시 보내도 그 뒤에 묶인다(스펙 D8). */
  async wmsOrderIdsWithFailedOutbox(wmsOrderIds: string[]): Promise<Set<string>> {
    if (wmsOrderIds.length === 0) return new Set();
    const rows = await this.db
      .selectDistinct({ aggregateId: outbox_events.aggregateId })
      .from(outbox_events)
      .where(
        and(
          eq(outbox_events.topic, ORDER_STREAM.topic.topic),
          eq(outbox_events.status, 'FAILED'),
          inArray(outbox_events.aggregateId, wmsOrderIds),
        ),
      );
    return new Set(rows.map((row) => row.aggregateId));
  }
}
