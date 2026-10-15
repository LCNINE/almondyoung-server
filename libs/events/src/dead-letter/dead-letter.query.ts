import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq, gt, inArray, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { NotFoundError } from '@app/shared/filters/domain-exceptions';
import { dead_letters } from './dead-letter.schema';
import { outbox_events } from '../outbox/outbox.schema';
import { FailureActionLog, type FailureActionRow } from './failure-action.log';
import { UNRESOLVED_DEAD_LETTER_STATUSES, type DeadLetterRow } from './dead-letter.types';
import { EVENT_FAILURES_OPTIONS, type EventFailuresOptions } from './event-failures.options';

export interface EventFailuresSummary {
  deadLetters: { failed: number; held: number; oldestFailedAt: string | null };
  outbox: { failed: number; oldestFailedAt: string | null };
}
export interface DeadLetterSequenceItem {
  id: number;
  topic: string;
  handler: string;
  eventType: string | null;
  sequenceKey: string | null;
  status: string;
  errorName: string | null;
  errorMessage: string | null;
  firstFailedAt: Date;
  redriveCount: number;
  heldBehind: number;
}
export interface DeadLetterDetail {
  row: DeadLetterRow;
  sequence: DeadLetterRow[];
  actions: FailureActionRow[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const UNRESOLVED = [...UNRESOLVED_DEAD_LETTER_STATUSES];

/** 화면이 읽는 것 (스펙 §9). 집계는 여기서 끝낸다. */
@Injectable()
export class DeadLetterQueryService {
  constructor(
    private readonly dbService: DbService,
    private readonly actions: FailureActionLog,
    @Inject(EVENT_FAILURES_OPTIONS) private readonly options: EventFailuresOptions,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async summary(): Promise<EventFailuresSummary> {
    const [dl] = await this.db
      .select({
        failed: sql<number>`count(*) filter (where ${dead_letters.status} = 'failed')::int`,
        held: sql<number>`count(*) filter (where ${dead_letters.status} = 'held')::int`,
        oldest: sql<Date | null>`min(${dead_letters.firstFailedAt}) filter (where ${dead_letters.status} in ('failed', 'held'))`,
      })
      .from(dead_letters);
    const [ob] = await this.db
      .select({
        failed: sql<number>`count(*)::int`,
        oldest: sql<Date | null>`min(${outbox_events.failedAt})`,
      })
      .from(outbox_events)
      .where(eq(outbox_events.status, 'FAILED'));
    return {
      deadLetters: { failed: dl?.failed ?? 0, held: dl?.held ?? 0, oldestFailedAt: toIso(dl?.oldest) },
      outbox: { failed: ob?.failed ?? 0, oldestFailedAt: toIso(ob?.oldest) },
    };
  }

  async listSequences(
    limitRaw?: string,
    cursorRaw?: string,
  ): Promise<{ items: DeadLetterSequenceItem[]; nextCursor: number | null }> {
    const limit = Math.min(Math.max(parseInt(limitRaw ?? '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const cursor = Math.max(parseInt(cursorRaw ?? '', 10) || 0, 0);
    const earlier = alias(dead_letters, 'earlier');
    const sequencedTopics = [...this.options.sequencedTopics];
    const rows = await this.db
      .select({
        id: dead_letters.id,
        topic: dead_letters.topic,
        handler: dead_letters.handler,
        eventType: dead_letters.eventType,
        sequenceKey: dead_letters.sequenceKey,
        status: dead_letters.status,
        errorName: dead_letters.errorName,
        errorMessage: dead_letters.errorMessage,
        firstFailedAt: dead_letters.firstFailedAt,
        redriveCount: dead_letters.redriveCount,
        // select-list 의 sql`` 안에서는 drizzle 이 테이블 한정자를 떼어 별칭·바깥 컬럼이 엇갈린다 —
        // 바깥(dead_letters)은 스키마 한정 이름으로, 안쪽은 별칭 later 로 직접 적는다.
        heldBehind: sql<number>`(
          select count(*)::int from "event"."dead_letters" as "later"
          where "later"."consumer_group" = "event"."dead_letters"."consumer_group"
            and "later"."topic" = "event"."dead_letters"."topic"
            and "later"."sequence_key" = "event"."dead_letters"."sequence_key"
            and "later"."status" in ('failed', 'held')
            and "later"."id" > "event"."dead_letters"."id"
            and ${inArray(sql.raw('"later"."topic"'), sequencedTopics)}
        )`,
      })
      .from(dead_letters)
      .where(
        and(
          inArray(dead_letters.status, UNRESOLVED),
          gt(dead_letters.id, cursor),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(earlier)
              .where(
                and(
                  eq(earlier.consumerGroup, dead_letters.consumerGroup),
                  eq(earlier.topic, dead_letters.topic),
                  eq(earlier.sequenceKey, dead_letters.sequenceKey),
                  inArray(earlier.topic, sequencedTopics),
                  inArray(earlier.status, UNRESOLVED),
                  sql`${earlier.id} < ${dead_letters.id}`,
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(dead_letters.id))
      .limit(limit + 1);
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }

  async detail(id: number): Promise<DeadLetterDetail> {
    const [row] = await this.db.select().from(dead_letters).where(eq(dead_letters.id, id));
    if (!row) throw new NotFoundError(`dead letter 가 없다: ${id}`);
    // 순서를 지키지 않는 토픽의 행은 혼자 한 순서다(redriver 의 `sequenceKeyOf` 와 같은 규칙)
    const sequence =
      row.sequenceKey === null || !this.options.sequencedTopics.includes(row.topic)
        ? [row]
        : await this.db
            .select()
            .from(dead_letters)
            .where(
              and(
                eq(dead_letters.consumerGroup, row.consumerGroup),
                eq(dead_letters.topic, row.topic),
                eq(dead_letters.sequenceKey, row.sequenceKey),
              ),
            )
            .orderBy(asc(dead_letters.id));
    const actions = await this.actions.forTargets(
      'dead_letter',
      sequence.map((r) => r.id),
    );
    return { row, sequence, actions };
  }
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
