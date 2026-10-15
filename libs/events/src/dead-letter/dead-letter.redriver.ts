import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared/filters/domain-exceptions';
import { dead_letters } from './dead-letter.schema';
import { DeadLetterRuntime } from './dead-letter.runtime';
import { FailureActionLog } from './failure-action.log';
import { tryLockSequence, type SequenceLockKey } from './sequence-lock';
import { UNRESOLVED_DEAD_LETTER_STATUSES, type DeadLetterRow } from './dead-letter.types';

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
 *
 * lock 을 쥔 트랜잭션은 루프 내내 열려 있고(같은 순서의 실시간 소비가 기다린다), 행 상태는 그 트랜잭션 밖(`this.db`)에서
 * 바로 커밋한다 — 중간에 죽어도 이미 성공한 행이 되돌아가 두 번 처리되지 않게 하기 위해서다.
 */
@Injectable()
export class DeadLetterRedriver {
  private readonly logger = new Logger(DeadLetterRedriver.name);

  constructor(
    private readonly dbService: DbService,
    private readonly runtime: DeadLetterRuntime,
    private readonly actions: FailureActionLog,
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

  async redriveAll(actor: string | null): Promise<RedriveAllResult> {
    const heads = await this.heads();
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
      sequenceKey: row.sequenceKey,
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

  private async nextInSequence(row: DeadLetterRow): Promise<DeadLetterRow | undefined> {
    const sequence =
      row.sequenceKey === null
        ? eq(dead_letters.id, row.id)
        : and(
            eq(dead_letters.consumerGroup, row.consumerGroup),
            eq(dead_letters.topic, row.topic),
            eq(dead_letters.sequenceKey, row.sequenceKey),
          );
    const [next] = await this.db
      .select()
      .from(dead_letters)
      .where(and(sequence, inArray(dead_letters.status, UNRESOLVED)))
      .orderBy(asc(dead_letters.id))
      .limit(1);
    return next;
  }

  /** 순서마다 가장 이른 안 푼 행 */
  private async heads(): Promise<DeadLetterRow[]> {
    const earlier = alias(dead_letters, 'earlier');
    return this.db
      .select()
      .from(dead_letters)
      .where(
        and(
          inArray(dead_letters.status, UNRESOLVED),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(earlier)
              .where(
                and(
                  eq(earlier.consumerGroup, dead_letters.consumerGroup),
                  eq(earlier.topic, dead_letters.topic),
                  eq(earlier.sequenceKey, dead_letters.sequenceKey),
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
    if (!UNRESOLVED.includes(row.status as (typeof UNRESOLVED)[number])) {
      throw new ConflictError(`이미 처리된 행이다: ${id} (${row.status})`);
    }
    return row;
  }
}
