import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { dead_letters } from './dead-letter.schema';
import { lockSequence } from './sequence-lock';
import { UNRESOLVED_DEAD_LETTER_STATUSES, type DeadLetterMessage, type DeadLetterRecorder } from './dead-letter.types';

/** 오류 문장은 진단용이다 — 스택이 수 KB 로 커지는 것을 막는다 */
const MAX_ERROR_MESSAGE = 2000;

/**
 * 실시간 보류 검사가 순서 lock 을 기다리는 상한. 다시 넣기는 lock 을 루프 내내 쥐므로(`DeadLetterRedriver` 머리 주석),
 * 기다림이 Kafka 세션 타임아웃을 넘기면 리밸런스가 난다. 끊기면 던지고 → `DlqDeliveryError` → 커밋하지 않고 다시 받는다.
 */
const HOLD_LOCK_TIMEOUT = '10s';

/** 칸 길이 — `dead-letter.schema.ts` 와 같아야 한다 */
const LIMITS = { handler: 200, topic: 100, sequenceKey: 200, messageId: 200, eventType: 100, errorName: 200 } as const;

/** Postgres 는 text·varchar·jsonb 어디에도 NUL(U+0000) 을 못 담는다 — 한 글자 때문에 기록이 영원히 실패하지 않게 지운다 */
function stripNul(value: string): string {
  return value.replaceAll('\u0000', '');
}

function clip(value: string, max: number): string {
  return stripNul(value).slice(0, max);
}

/** envelope 의 모든 문자열(키 포함)에서 NUL 을 지운다. 문자열로 바꿔 치환하면 `\\u0000`(백슬래시+글자) 을 잘못 건드린다 */
function stripNulDeep(value: unknown): unknown {
  if (typeof value === 'string') return stripNul(value);
  if (Array.isArray(value)) return value.map(stripNulDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [stripNul(key), stripNulDeep(inner)]));
  }
  return value;
}

/**
 * 나쁜 메시지가 기록을 영원히 실패시키지 않게(최종 리뷰 D6) — 실패한 기록은 커밋되지 않고 다시 오므로, 막히면 파티션이 멈춘다.
 * 칸 길이로 자르는 것은 유일 키(그룹·핸들러·messageId)를 거칠게 만들 수 있지만, 200 자를 넘는 messageId 는 계약 밖이다.
 */
function toInsert(message: DeadLetterMessage) {
  return {
    consumerGroup: message.consumerGroup,
    handler: clip(message.handler, LIMITS.handler),
    topic: clip(message.topic, LIMITS.topic),
    sequenceKey: message.sequenceKey === null ? null : clip(message.sequenceKey, LIMITS.sequenceKey),
    messageId: clip(message.messageId, LIMITS.messageId),
    eventType: message.eventType === null ? null : clip(message.eventType, LIMITS.eventType),
    envelope: stripNulDeep(message.envelope),
    kafkaPartition: message.kafkaPartition,
    kafkaOffset: message.kafkaOffset,
  };
}

function errorColumns(error: Error) {
  return {
    errorName: clip(error.name, LIMITS.errorName),
    errorMessage: clip(error.message, MAX_ERROR_MESSAGE),
  };
}

/**
 * 컨슈머 실패의 쓰기 쪽 (#1016 8번, 스펙 §6). 인터셉터가 `DeadLetterRecorder` 로 부른다.
 * 조회·다시 넣기는 `DeadLetterQueryService`·`DeadLetterRedriver` 가 한다.
 */
@Injectable()
export class DeadLetterStore implements DeadLetterRecorder {
  constructor(private readonly dbService: DbService) {}

  private get db() {
    return this.dbService.db;
  }

  async holdIfBlocked(message: DeadLetterMessage): Promise<boolean> {
    const row = toInsert(message);
    const sequenceKey = row.sequenceKey;
    if (sequenceKey === null) return false;

    return this.db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local lock_timeout = '${HOLD_LOCK_TIMEOUT}'`));
      // 정리한 값으로 잠근다 — 다시 넣기는 저장된 행의 값으로 잠그므로 두 쪽이 같은 lock 을 잡아야 한다
      await lockSequence(tx, { consumerGroup: row.consumerGroup, topic: row.topic, sequenceKey });
      const [blocking] = await tx
        .select({ id: dead_letters.id })
        .from(dead_letters)
        .where(
          and(
            eq(dead_letters.consumerGroup, row.consumerGroup),
            eq(dead_letters.topic, row.topic),
            eq(dead_letters.sequenceKey, sequenceKey),
            inArray(dead_letters.status, [...UNRESOLVED_DEAD_LETTER_STATUSES]),
          ),
        )
        .limit(1);
      if (!blocking) return false;

      // 재전달된 같은 메시지면 유일 키 충돌로 아무것도 안 적는다 — 그래도 막혀 있으니 true 다(스펙 §7.4 마지막 줄).
      await tx
        .insert(dead_letters)
        .values({ ...row, status: 'held' })
        .onConflictDoNothing({ target: [dead_letters.consumerGroup, dead_letters.handler, dead_letters.messageId] });
      return true;
    });
  }

  async recordFailure(message: DeadLetterMessage, error: Error): Promise<void> {
    const errorFields = errorColumns(error);
    await this.db
      .insert(dead_letters)
      .values({ ...toInsert(message), status: 'failed', ...errorFields })
      .onConflictDoUpdate({
        target: [dead_letters.consumerGroup, dead_letters.handler, dead_letters.messageId],
        set: { status: 'failed', ...errorFields, lastFailedAt: sql`now()` },
      });
  }

  async markRedriven(id: number): Promise<void> {
    await this.db
      .update(dead_letters)
      .set({ status: 'redriven', redriveCount: sql`${dead_letters.redriveCount} + 1`, resolvedAt: sql`now()` })
      .where(eq(dead_letters.id, id));
  }

  async recordRedriveFailure(id: number, error: Error): Promise<void> {
    await this.db
      .update(dead_letters)
      .set({
        status: 'failed',
        redriveCount: sql`${dead_letters.redriveCount} + 1`,
        ...errorColumns(error),
        lastFailedAt: sql`now()`,
      })
      .where(eq(dead_letters.id, id));
  }
}
