import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared/filters/domain-exceptions';
import { outbox_events } from './outbox.schema';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import { FailureActionLog, type FailureActionRow } from '../dead-letter/failure-action.log';

export interface OutboxFailedItem {
  id: number;
  topic: string;
  eventType: string;
  aggregateId: string;
  createdAt: Date;
  failedAt: Date | null;
  retryCount: number;
  errorMessage: string | null;
  /** 같은 (topic, aggregate_id) 뒤에서 기다리는 PENDING 수 — `sequencedTopics` 가 막고 있는 것. 목록 밖 토픽은 0 */
  waitingBehind: number;
}
export interface OutboxFailureDetail extends OutboxFailedItem {
  status: string;
  payload: unknown;
  actions: FailureActionRow[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_REASON = 500;

const dispatchColumns = {
  id: outbox_events.id,
  topic: outbox_events.topic,
  aggregateType: outbox_events.aggregateType,
  aggregateId: outbox_events.aggregateId,
  eventType: outbox_events.eventType,
  partitionKey: outbox_events.partitionKey,
  payload: outbox_events.payload,
  retryCount: outbox_events.retryCount,
  createdAt: outbox_events.createdAt,
};

/** outbox 출구 (#1016 7번, 스펙 §8.3~8.5). 발행 자체는 디스패처의 길을 그대로 탄다. */
@Injectable()
export class OutboxFailuresService {
  constructor(
    private readonly dbService: DbService,
    private readonly dispatcher: OutboxDispatcher,
    private readonly actions: FailureActionLog,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async listFailed(
    limitRaw?: string,
    cursorRaw?: string,
  ): Promise<{ items: OutboxFailedItem[]; nextCursor: number | null }> {
    const limit = Math.min(Math.max(parseInt(limitRaw ?? '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const cursor = Math.max(parseInt(cursorRaw ?? '', 10) || 0, 0);
    const rows = await this.selectFailed(
      and(eq(outbox_events.status, 'FAILED'), gt(outbox_events.id, cursor)),
      limit + 1,
    );
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }

  async detail(id: number): Promise<OutboxFailureDetail> {
    const [row] = await this.db.select().from(outbox_events).where(eq(outbox_events.id, id));
    if (!row) throw new NotFoundError(`outbox 행이 없다: ${id}`);
    const [item] = await this.selectFailed(eq(outbox_events.id, id), 1);
    return {
      ...item,
      status: row.status,
      payload: row.payload,
      actions: await this.actions.forTargets('outbox', [id]),
    };
  }

  async resend(
    id: number,
    actor: string | null,
  ): Promise<{ status: 'PUBLISHED' } | { status: 'FAILED'; error: string }> {
    const [leased] = await this.db
      .update(outbox_events)
      .set({ status: 'PROCESSING', processingStartedAt: new Date() })
      .where(and(eq(outbox_events.id, id), eq(outbox_events.status, 'FAILED')))
      .returning(dispatchColumns);
    if (!leased) throw new ConflictError(`FAILED 상태의 outbox 행이 아니다: ${id}`);

    const outcome = await this.dispatcher.publishLeasedRow(leased);
    await this.actions.record({
      targetKind: 'outbox',
      targetId: id,
      action: 'redrive',
      outcome: outcome.ok ? 'succeeded' : 'failed',
      actor,
      note: outcome.ok ? null : outcome.error,
    });
    return outcome.ok ? { status: 'PUBLISHED' } : { status: 'FAILED', error: outcome.error };
  }

  async discard(id: number, actor: string | null, reason: string): Promise<{ status: 'DISCARDED' }> {
    const note = reason?.trim();
    if (!note) throw new BadRequestError('종결 사유가 필요하다');
    const [row] = await this.db
      .update(outbox_events)
      .set({ status: 'DISCARDED', processingStartedAt: null })
      .where(and(eq(outbox_events.id, id), eq(outbox_events.status, 'FAILED')))
      .returning({ id: outbox_events.id });
    if (!row) throw new ConflictError(`FAILED 상태의 outbox 행이 아니다: ${id}`);
    await this.actions.record({
      targetKind: 'outbox',
      targetId: id,
      action: 'discard',
      outcome: 'succeeded',
      actor,
      note: note.slice(0, MAX_REASON),
    });
    return { status: 'DISCARDED' };
  }

  async resendAll(
    actor: string | null,
  ): Promise<{ total: number; published: number; failed: Array<{ id: number; error: string }> }> {
    const ids = (
      await this.db
        .select({ id: outbox_events.id })
        .from(outbox_events)
        .where(eq(outbox_events.status, 'FAILED'))
        .orderBy(asc(outbox_events.createdAt), asc(outbox_events.id))
    ).map((r) => r.id);
    const failed: Array<{ id: number; error: string }> = [];
    let published = 0;
    for (const id of ids) {
      try {
        const outcome = await this.resend(id, actor);
        if (outcome.status === 'PUBLISHED') published += 1;
        else failed.push({ id, error: outcome.error });
      } catch (error) {
        // 그 사이 다른 사람이 처리했다(409) — 건너뛴다
        if (!(error instanceof ConflictError)) throw error;
      }
    }
    return { total: ids.length, published, failed };
  }

  private async selectFailed(where: SQL | undefined, limit: number): Promise<OutboxFailedItem[]> {
    return this.db
      .select({
        id: outbox_events.id,
        topic: outbox_events.topic,
        eventType: outbox_events.eventType,
        aggregateId: outbox_events.aggregateId,
        createdAt: outbox_events.createdAt,
        failedAt: outbox_events.failedAt,
        retryCount: outbox_events.retryCount,
        errorMessage: outbox_events.errorMessage,
        // select 목록 안에서는 drizzle 이 컬럼의 테이블 한정자를 떼므로 바깥 행은 스키마 한정 이름으로 직접 가리킨다
        // (안 그러면 `topic = topic` 이 안쪽 행끼리의 비교가 된다).
        waitingBehind: sql<number>`(
          select count(*)::int from ${outbox_events} behind
          where behind.topic = "event"."outbox_events"."topic"
            and behind.aggregate_id = "event"."outbox_events"."aggregate_id"
            and behind.status = 'PENDING'
            and behind.id > "event"."outbox_events"."id"
            and ${inArray(sql.raw('behind.topic'), [...this.dispatcher.sequencedTopics])}
        )`,
      })
      .from(outbox_events)
      .where(where)
      .orderBy(asc(outbox_events.id))
      .limit(limit);
  }
}
