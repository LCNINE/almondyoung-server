import { Inject, Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared/filters/domain-exceptions';
import { dead_letters } from './dead-letter.schema';
import { DeadLetterRuntime } from './dead-letter.runtime';
import { FailureActionLog } from './failure-action.log';
import { tryLockSequence, type SequenceLockKey } from './sequence-lock';
import { EVENT_FAILURES_OPTIONS, type EventFailuresOptions } from './event-failures.options';
import { isUnresolvedStatus, UNRESOLVED_DEAD_LETTER_STATUSES, type DeadLetterRow } from './dead-letter.types';

export interface RedriveStop {
  id: number;
  errorName: string | null;
  errorMessage: string | null;
}
export interface RedriveResult {
  processed: number;
  stoppedAt: RedriveStop | null;
}
export interface RedriveAllResult {
  sequences: number;
  succeeded: number;
  stopped: number;
  /** 다른 사람이 다시 넣는 중이라 건너뛴 순서 */
  busy: number;
  stoppedByError: Record<string, number>;
}

const MAX_REASON = 500;
const UNRESOLVED = [...UNRESOLVED_DEAD_LETTER_STATUSES];

/**
 * 다시 넣기와 종결 (#1016 8번, 스펙 §7). 단위는 «순서» = 같은 (그룹, 토픽, 순서 키)의 `failed`·`held`.
 * 순서를 지키지 않는 토픽(`EventFailuresOptions.sequencedTopics` 밖)·키 없는 행은 그 행 혼자 한 순서다.
 *
 * **다시 넣기는 순서 lock 을 루프 내내 쥔다.** lock 을 쥔 트랜잭션은 마지막 행까지 열려 있고, 그동안 같은 순서의 실시간
 * 소비는 보류 검사에서 기다린다 — 그 대기는 `DeadLetterStore.holdIfBlocked` 의 `lock_timeout`(10초)에서 끊겨 커밋하지
 * 않고 다시 받는다(Kafka 세션 타임아웃을 넘겨 리밸런스가 나지 않게). 행 상태는 그 트랜잭션 밖(`this.db`)에서 바로
 * 커밋한다 — 중간에 죽어도 이미 성공한 행이 되돌아가 두 번 처리되지 않게 하기 위해서다.
 *
 * **풀은 연결이 둘 이상이어야 한다** — 하나는 lock 트랜잭션이 쥐고, 행 쓰기·다시 넣은 핸들러의 쓰기가 다른 연결을 쓴다.
 * 연결이 하나면 lock 트랜잭션이 끝나기를 기다리며 멈춘다(`DbService` 기본 풀은 10).
 */
@Injectable()
export class DeadLetterRedriver {
  private readonly logger = new Logger(DeadLetterRedriver.name);

  constructor(
    private readonly dbService: DbService,
    private readonly runtime: DeadLetterRuntime,
    private readonly actions: FailureActionLog,
    @Inject(EVENT_FAILURES_OPTIONS) private readonly options: EventFailuresOptions,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async redrive(id: number, actor: string | null): Promise<RedriveResult> {
    const row = await this.load(id);
    return this.runSequence(row, actor);
  }

  async discard(id: number, actor: string | null, reason: string): Promise<RedriveResult> {
    const note = reason?.trim();
    if (!note) throw new BadRequestError('종결 사유가 필요하다');
    const row = await this.load(id);
    return this.runSequence(row, actor, note.slice(0, MAX_REASON));
  }

  /** `topic` 을 주면 그 토픽의 순서만 — 목록 화면의 토픽 거르기와 같은 범위 */
  async redriveAll(actor: string | null, topic?: string): Promise<RedriveAllResult> {
    const heads = await this.heads(topic);
    const result: RedriveAllResult = { sequences: heads.length, succeeded: 0, stopped: 0, busy: 0, stoppedByError: {} };
    for (const head of heads) {
      try {
        const outcome = await this.runSequence(head, actor);
        if (outcome.stoppedAt) {
          result.stopped += 1;
          const name = outcome.stoppedAt.errorName ?? 'Unknown';
          result.stoppedByError[name] = (result.stoppedByError[name] ?? 0) + 1;
        } else {
          result.succeeded += 1;
        }
      } catch (error) {
        if (error instanceof ConflictError) result.busy += 1;
        else throw error;
      }
    }
    return result;
  }

  private async runSequence(row: DeadLetterRow, actor: string | null, discardReason?: string): Promise<RedriveResult> {
    const key: SequenceLockKey = {
      consumerGroup: row.consumerGroup,
      topic: row.topic,
      sequenceKey: this.sequenceKeyOf(row),
      rowId: row.id,
    };

    return this.db.transaction(async (tx) => {
      if (!(await tryLockSequence(tx, key))) {
        throw new ConflictError('이 순서를 이미 다시 넣는 작업이 진행 중이다');
      }

      if (discardReason !== undefined) {
        const headBefore = await this.nextInSequence(row);
        const [discarded] = await this.db
          .update(dead_letters)
          .set({ status: 'discarded', resolvedAt: sql`now()` })
          .where(and(eq(dead_letters.id, row.id), inArray(dead_letters.status, UNRESOLVED)))
          .returning({ id: dead_letters.id });
        if (!discarded) throw new ConflictError('이미 처리된 행이다');
        await this.actions.record({
          targetKind: 'dead_letter',
          targetId: row.id,
          action: 'discard',
          outcome: 'succeeded',
          actor,
          note: discardReason,
        });
        // 머리가 아니었으면 머리가 그대로라 아무것도 흐르지 않는다(스펙 §7.5)
        if (headBefore?.id !== row.id) return { processed: 0, stoppedAt: null };
      }

      let processed = 0;
      for (;;) {
        const next = await this.nextInSequence(row);
        if (!next) return { processed, stoppedAt: null };

        const stop = await this.dispatchOne(next);
        await this.actions.record({
          targetKind: 'dead_letter',
          targetId: next.id,
          action: 'redrive',
          outcome: stop ? 'failed' : 'succeeded',
          actor,
          note: stop?.errorMessage ?? null,
        });
        if (stop) return { processed, stoppedAt: stop };
        processed += 1;
      }
    });
  }

  /**
   * 한 행을 다시 넣고 결과를 읽는다. 인터셉터가 그 행에 성공(`redriven`, 횟수+1)·실패(`failed`, 횟수+1)를 적는다.
   * 횟수가 그대로면 핸들러가 돌지 않은 것이다(이벤트 종류·핸들러 이름이 바뀐 경우) — 옛 오류를 결과로 착각하지 않는다.
   */
  private async dispatchOne(row: DeadLetterRow): Promise<RedriveStop | null> {
    const stopWith = (error: Error): RedriveStop => {
      this.logger.warn({ msg: 'Redrive stopped', deadLetterId: row.id, error: error.message });
      return { id: row.id, errorName: error.name, errorMessage: error.message };
    };

    try {
      const handled = await this.runtime.dispatch(row);
      if (!handled) return stopWith(new Error(`토픽 ${row.topic} 의 핸들러가 이 앱에 없다`));
    } catch (error) {
      // 인터셉터가 결과를 적지 못했다(DlqDeliveryError 등). 행은 그대로 두고 멈춘다.
      return stopWith(error instanceof Error ? error : new Error(String(error)));
    }

    const [after] = await this.db.select().from(dead_letters).where(eq(dead_letters.id, row.id));
    if (!after || after.redriveCount === row.redriveCount) {
      return stopWith(new Error('핸들러가 실행되지 않았다 — 이벤트 종류·핸들러 이름이 바뀌었는지 확인'));
    }
    if (after.status === 'redriven') return null;
    this.logger.warn({ msg: 'Redrive stopped', deadLetterId: row.id, error: after.errorMessage });
    return { id: row.id, errorName: after.errorName, errorMessage: after.errorMessage };
  }

  /**
   * 순서를 묶는 키. 키가 없거나 순서를 지키지 않는 토픽(`sequencedTopics` 밖)의 행은 null — 그 행 혼자 한 순서다.
   * 실시간 소비가 그 토픽에서 보류하지 않으므로 다시 넣기도 뒤 행을 끌고 가지 않는다.
   */
  private sequenceKeyOf(row: DeadLetterRow): string | null {
    return row.sequenceKey !== null && this.options.sequencedTopics.includes(row.topic) ? row.sequenceKey : null;
  }

  private async nextInSequence(row: DeadLetterRow): Promise<DeadLetterRow | undefined> {
    const sequenceKey = this.sequenceKeyOf(row);
    const sequence =
      sequenceKey === null
        ? eq(dead_letters.id, row.id)
        : and(
            eq(dead_letters.consumerGroup, row.consumerGroup),
            eq(dead_letters.topic, row.topic),
            eq(dead_letters.sequenceKey, sequenceKey),
          );
    const [next] = await this.db
      .select()
      .from(dead_letters)
      .where(and(sequence, inArray(dead_letters.status, UNRESOLVED)))
      .orderBy(asc(dead_letters.id))
      .limit(1);
    return next;
  }

  /** 순서마다 가장 이른 안 푼 행. 순서를 지키지 않는 토픽의 행은 전부 각자 머리다(`earlier` 가 그 토픽을 보지 않는다) */
  private async heads(topic?: string): Promise<DeadLetterRow[]> {
    const earlier = alias(dead_letters, 'earlier');
    return this.db
      .select()
      .from(dead_letters)
      .where(
        and(
          inArray(dead_letters.status, UNRESOLVED),
          topic ? eq(dead_letters.topic, topic) : undefined,
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(earlier)
              .where(
                and(
                  eq(earlier.consumerGroup, dead_letters.consumerGroup),
                  eq(earlier.topic, dead_letters.topic),
                  eq(earlier.sequenceKey, dead_letters.sequenceKey),
                  inArray(earlier.topic, [...this.options.sequencedTopics]),
                  inArray(earlier.status, UNRESOLVED),
                  sql`${earlier.id} < ${dead_letters.id}`,
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(dead_letters.id));
  }

  private async load(id: number): Promise<DeadLetterRow> {
    const [row] = await this.db.select().from(dead_letters).where(eq(dead_letters.id, id));
    if (!row) throw new NotFoundError(`dead letter 가 없다: ${id}`);
    if (!isUnresolvedStatus(row.status)) {
      throw new ConflictError(`이미 처리된 행이다: ${id} (${row.status})`);
    }
    return row;
  }
}
