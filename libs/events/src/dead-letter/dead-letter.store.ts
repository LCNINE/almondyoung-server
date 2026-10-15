import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { dead_letters } from './dead-letter.schema';
import { lockSequence } from './sequence-lock';
import { UNRESOLVED_DEAD_LETTER_STATUSES, type DeadLetterMessage, type DeadLetterRecorder } from './dead-letter.types';

/** 오류 문장은 진단용이다 — 스택이 수 KB 로 커지는 것을 막는다 */
const MAX_ERROR_MESSAGE = 2000;

function toInsert(message: DeadLetterMessage) {
  return {
    consumerGroup: message.consumerGroup,
    handler: message.handler,
    topic: message.topic,
    sequenceKey: message.sequenceKey,
    messageId: message.messageId,
    eventType: message.eventType,
    envelope: message.envelope,
    kafkaPartition: message.kafkaPartition,
    kafkaOffset: message.kafkaOffset,
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
    if (message.sequenceKey === null) return false;

    return this.db.transaction(async (tx) => {
      await lockSequence(tx, message);
      const [blocking] = await tx
        .select({ id: dead_letters.id })
        .from(dead_letters)
        .where(
          and(
            eq(dead_letters.consumerGroup, message.consumerGroup),
            eq(dead_letters.topic, message.topic),
            eq(dead_letters.sequenceKey, message.sequenceKey as string),
            inArray(dead_letters.status, [...UNRESOLVED_DEAD_LETTER_STATUSES]),
          ),
        )
        .limit(1);
      if (!blocking) return false;

      // 재전달된 같은 메시지면 유일 키 충돌로 아무것도 안 적는다 — 그래도 막혀 있으니 true 다(스펙 §7.4 마지막 줄).
      await tx
        .insert(dead_letters)
        .values({ ...toInsert(message), status: 'held' })
        .onConflictDoNothing({ target: [dead_letters.consumerGroup, dead_letters.handler, dead_letters.messageId] });
      return true;
    });
  }

  async recordFailure(message: DeadLetterMessage, error: Error): Promise<void> {
    const errorMessage = error.message.slice(0, MAX_ERROR_MESSAGE);
    await this.db
      .insert(dead_letters)
      .values({ ...toInsert(message), status: 'failed', errorName: error.name, errorMessage })
      .onConflictDoUpdate({
        target: [dead_letters.consumerGroup, dead_letters.handler, dead_letters.messageId],
        set: { status: 'failed', errorName: error.name, errorMessage, lastFailedAt: sql`now()` },
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
        errorName: error.name,
        errorMessage: error.message.slice(0, MAX_ERROR_MESSAGE),
        lastFailedAt: sql`now()`,
      })
      .where(eq(dead_letters.id, id));
  }
}
