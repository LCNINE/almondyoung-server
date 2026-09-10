import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { inArray, sql } from 'drizzle-orm';
import { outbox_events } from './outbox.schema';
import {
  initOutboxTopicSeries,
  setOutboxFailedRows,
  setOutboxOldestPendingAge,
  setOutboxPending,
  setOutboxRetryPending,
} from './outbox.metrics';

/** postgres.js 는 `count(*)`·`extract` 를 문자열로 준다. 파싱 불가는 0 으로 떨어뜨린다. */
function toCount(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 아웃박스 적체 게이지를 주기적으로 갱신한다 (#712).
 *
 * **왜 cron 이 쓰고 scrape 는 읽기만 하나:** 계산을 scrape 시점 `collect()` 콜백에 두면 DB 가
 * 느릴 때 스크레이프가 지연·타임아웃되고, 그러면 `up=0` 이 되어 **관측 실패가 가용성 알람으로
 * 승격**된다. 정확히 피해야 할 모양이라 값은 미리 메모리에 써 둔다.
 *
 * **왜 디스패처(5초)에 얹지 않나:** 적체 중에는 `count(*)` 가 무거워진다. 디스패처 주기에 묶으면
 * 하필 장애 중에 부하가 는다. 15초는 스크레이프 주기(core 30s · 나머지 60s)보다 충분히 촘촘하다.
 *
 * 태스크가 겹쳐 이 크론이 두 번 돌아도 안전하다 — 게이지는 같은 값을 두 번 쓸 뿐이다(#707).
 */
@Injectable()
export class OutboxMetricsCollector {
  private readonly logger = new Logger(OutboxMetricsCollector.name);

  /** 0 시리즈를 세워 둔 토픽. 매 tick 이 이 집합 전체를 쓴다 — 그래야 낡은 값이 안 남는다. */
  private readonly knownTopics = new Set<string>();
  private historicalTopicsSeeded = false;

  constructor(
    private readonly dbService: DbService,
    declaredTopics: string[] = [],
  ) {
    // 첫 tick 을 기다리지 않고 부팅 즉시 시리즈를 세운다.
    declaredTopics.forEach((topic) => this.track(topic));
  }

  private get db() {
    return this.dbService.db;
  }

  private track(topic: string): void {
    if (this.knownTopics.has(topic)) return;
    this.knownTopics.add(topic);
    initOutboxTopicSeries(topic);
  }

  // cron-overlap-safe: 겹쳐도 게이지에 같은 값을 두 번 쓸 뿐인 멱등 갱신이다(#707) — CronOnceModule 없는 앱에서도 돌아야 하므로 @CronOnce 로 바꾸지 않는다(ADR-0036).
  @Cron('*/15 * * * * *')
  async refresh(): Promise<void> {
    try {
      await this.seedHistoricalTopicsOnce();
      await this.publishAggregate();
    } catch (error) {
      // 던지면 스케줄러 로그만 더럽히고 다음 tick 도 같은 이유로 죽는다. 값은 낡은 채 남는데,
      // 그건 `up` 과 스크레이프 자체가 여전히 성공한다는 뜻이라 무음보다 낫다.
      this.logger.error(`Outbox metrics refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 앱이 `publishes` 로 선언한 토픽만으로는 부족하다. core 가 그 반례다 — 아웃박스를 켠 것은
   * catalog 하나인데 적재는 더 많은 토픽이 한다(`OutboxDispatcher.resolvePublisher` 가 존재하는
   * 이유). 선언에만 기대면 그 토픽들이 영구히 무음이 되므로, 테이블에 이력이 있는 토픽도 훑는다.
   *
   * 한 번만 돈다. 이후에 새로 생기는 토픽은 집계 결과에 나타나는 순간 등록된다.
   */
  private async seedHistoricalTopicsOnce(): Promise<void> {
    if (this.historicalTopicsSeeded) return;

    const rows = await this.db.selectDistinct({ topic: outbox_events.topic }).from(outbox_events);
    rows.forEach((row: { topic: string }) => this.track(row.topic));
    this.historicalTopicsSeeded = true;
  }

  /**
   * 집계는 **DB 왕복 1회**다. 토픽마다 쿼리를 돌면 적체 중에 왕복이 토픽 수만큼 늘어난다.
   *
   * 나이를 DB 안에서 계산하는 이유: `created_at` 은 이 테이블에서 `withTimezone` 이 **아닌**
   * 컬럼이다(스키마 주석 참고 — tz 를 붙인 것은 `next_attempt_at` 하나뿐이다). JS 로 가져와
   * `Date.now()` 와 빼면 세션 TZ 차이만큼 어긋나고, **세션 TZ 가 UTC 인 환경에서는 무증상**이라
   * 더 나쁘다. `now() at time zone 'UTC'` 로 양쪽을 UTC wall time 으로 맞춰 뺀다.
   */
  private async publishAggregate(): Promise<void> {
    const rows = await this.db
      .select({
        topic: outbox_events.topic,
        pending: sql<string>`count(*) filter (where ${outbox_events.status} = 'PENDING')`,
        failed: sql<string>`count(*) filter (where ${outbox_events.status} = 'FAILED')`,
        retryPending: sql<string>`count(*) filter (where ${outbox_events.status} = 'PENDING' and ${outbox_events.retryCount} > 0)`,
        oldestPendingAgeSeconds: sql<
          string | null
        >`extract(epoch from (now() at time zone 'UTC') - min(${outbox_events.createdAt}) filter (where ${outbox_events.status} = 'PENDING'))`,
      })
      .from(outbox_events)
      .where(inArray(outbox_events.status, ['PENDING', 'FAILED']))
      .groupBy(outbox_events.topic);

    const byTopic = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      this.track(row.topic);
      byTopic.set(row.topic, row);
    }

    // 결과에 없는 토픽에도 0 을 쓴다 — `setLedgerDrift` 계열의 관례다. 안 그러면 적체가 해소된
    // 뒤에도 마지막 값이 남아 영원히 적체 중인 것처럼 보인다.
    for (const topic of this.knownTopics) {
      const row = byTopic.get(topic);
      setOutboxPending(topic, toCount(row?.pending));
      setOutboxFailedRows(topic, toCount(row?.failed));
      setOutboxRetryPending(topic, toCount(row?.retryPending));
      setOutboxOldestPendingAge(topic, toCount(row?.oldestPendingAgeSeconds));
    }
  }
}
