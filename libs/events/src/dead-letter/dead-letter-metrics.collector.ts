import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService, describeFailedRun } from '@app/db';
import { inArray, sql } from 'drizzle-orm';
import { dead_letters } from './dead-letter.schema';
import { setDeadLetterCount } from './dead-letter.metrics';
import { DeadLetterRuntime } from './dead-letter.runtime';
import { isUnresolvedStatus, type UnresolvedDeadLetterStatus } from './dead-letter.types';

/**
 * 안 푼 컨슈머 실패 건수를 15초마다 게이지에 쓴다 (#1016 8번).
 * 이유는 `OutboxMetricsCollector` 머리 주석(스크레이프 시점 계산 금지)과 같다.
 */
@Injectable()
export class DeadLetterMetricsCollector {
  private readonly logger = new Logger(DeadLetterMetricsCollector.name);
  /** 한 번이라도 쓴 조합. 다음 tick 에 결과에서 빠지면 0 으로 되돌린다 — 낡은 값이 남지 않게. */
  private readonly known = new Map<string, { topic: string; status: UnresolvedDeadLetterStatus }>();
  private loggedDetached = false;

  constructor(
    private readonly dbService: DbService,
    private readonly runtime: DeadLetterRuntime,
  ) {}

  // cron-overlap-safe: 겹쳐도 게이지에 같은 값을 두 번 쓸 뿐인 멱등 갱신이다(#707, OutboxMetricsCollector 와 같음).
  @Cron('*/15 * * * * *')
  async refresh(): Promise<void> {
    // 실패 테이블 모드가 꺼져 있으면(테이블이 없어 startConsumer 가 붙이지 않았다) 15초마다 실패 로그를 쌓지 않는다.
    // 원인은 startConsumer 가 ERROR 로 한 번 말했다.
    if (!this.runtime.isAttached) {
      if (!this.loggedDetached) {
        this.loggedDetached = true;
        this.logger.warn(
          'Dead letter metrics skipped — 실패 테이블 모드가 꺼져 있다(컨슈머 시작 전이거나 테이블 없음)',
        );
      }
      return;
    }
    // DB(테넌트)마다 세어 더한다. 게이지에 테넌트 라벨은 없다 — DB 마다 쓰면 마지막 DB 가 앞의 값을 덮는다.
    const runs = await this.dbService.forEachDatabase(() =>
      this.dbService.db
        .select({ topic: dead_letters.topic, status: dead_letters.status, count: sql<number>`count(*)::int` })
        .from(dead_letters)
        .where(inArray(dead_letters.status, ['failed', 'held']))
        .groupBy(dead_letters.topic, dead_letters.status),
    );

    const counts = new Map<string, { topic: string; status: UnresolvedDeadLetterStatus; count: number }>();
    for (const run of runs) {
      if (!run.ok) {
        this.logger.error(`Dead letter metrics refresh failed: ${describeFailedRun(run)}`);
        continue;
      }
      for (const row of run.value) {
        if (!isUnresolvedStatus(row.status)) continue;
        const key = `${row.topic}\u0000${row.status}`;
        const seen = counts.get(key);
        if (seen) seen.count += Number(row.count);
        else counts.set(key, { topic: row.topic, status: row.status, count: Number(row.count) });
      }
    }
    // 값이 하나도 없으면 낡은 값을 0 으로 덮지 않는다(옛 동작)
    if (runs.every((run) => !run.ok)) return;

    for (const [key, entry] of counts) {
      this.known.set(key, { topic: entry.topic, status: entry.status });
      setDeadLetterCount(entry.topic, entry.status, entry.count);
    }
    for (const [key, { topic, status }] of this.known) {
      if (!counts.has(key)) setDeadLetterCount(topic, status, 0);
    }
  }
}
