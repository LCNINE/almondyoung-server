import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import type { MessageEnvelope } from '@packages/event-contracts/types';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { outbox_events } from './outbox.schema';
import { OutboxConfig } from './outbox.types';
import { recordOutboxFailed, recordOutboxPublished } from './outbox.metrics';
import type { OutboxDispatchGate } from './outbox-dispatch-gate.port';
import type { EventTenantStamp } from '../tenancy/event-tenant-stamp';
import { eq, inArray, notInArray, and, lt, lte, or, isNull, not, ilike, sql, type SQL } from 'drizzle-orm';

/**
 * 실패 후 다음 시도까지의 대기(초). core 로컬 판본
 * (`apps/core/.../fulfillment/outbox/outbox-dispatcher.service.ts`)에서 그대로 승격했다.
 * `retryCount` 는 실패 **후** 값이므로 1회차 실패 → 10초, 2회차 → 30초, … 마지막 값이 상한이다.
 */
export const OUTBOX_RETRY_DELAYS_SECONDS = [10, 30, 60, 300] as const;

/**
 * 주문 경로 앱(core·channel-adapter)이 쓰는 긴 간격표 (#1016 7번, 스펙 D4). `maxRetries` 8 과 짝이고 합이 약 1시간 52분이다 —
 * 그 안에 끝나는 장애는 사람 없이 풀린다. 마지막 시도까지 기다리는 횟수는 `maxRetries - 1` 이다.
 */
export const LONG_OUTBOX_RETRY_DELAYS_SECONDS = [10, 30, 60, 300, 900, 1800, 3600] as const;
export const LONG_OUTBOX_MAX_RETRIES = 8;

/** `retryCount` 는 실패 **후** 값이다. 표를 넘으면 마지막 값을 유지한다. */
export function nextAttemptDelaySeconds(retryCount: number, delays: readonly number[]): number {
  return delays[Math.min(retryCount - 1, delays.length - 1)];
}

/**
 * `acquireEventBatch` 가 고른 한 행. select 투영과 같은 모양이며, 이 타입이 있어서
 * `processEvent`/`handleFailure` 가 `any` 를 받지 않아도 된다 — `partitionKey` 처럼 **없을 수도
 * 있는** 컬럼이 새로 생겼기 때문에, 옵셔널 여부를 타입이 말해 주는 편이 낫다.
 */
export type OutboxDispatchRow = {
  id: number;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  partitionKey: string | null;
  payload: unknown;
  retryCount: number;
  createdAt: Date;
};

/**
 * 공용 아웃박스 디스패처.
 *
 * ADR-0029 §5-1 (Task 6-C-1) 로 **core 로컬 판본과 기능 동등**해졌다. 그 전까지 이 클래스는
 * `status='PENDING' AND retry_count < max` 만 보고 5초마다 **즉시** 재시도했다 — 영구 실패하는
 * 행이 브로커를 계속 두드렸다. 승격된 성질은 둘이다:
 *
 *  1. **예약 백오프** — 실패한 행은 `next_attempt_at` 이 지날 때까지 선택되지 않는다.
 *  2. **크래시 복구 시 attempts 미증가** — 발행 도중 프로세스가 죽으면 lease 만료 후
 *     `retry_count` 를 올리지 않고 다시 시도한다. 증가 지점은 `handleFailure` 한 곳뿐이다.
 *
 * **lease 의 인코딩은 core 와 다르다 — 의도적이다 (ADR-0029 §5-1).** core 는 `next_attempt_at`
 * 한 컬럼에 "다음 시도 시각"과 "지금 발행 중"을 겹쳐 싣는다. 여기서는 그 두 사실을 나눠 둔다 —
 * 생명주기는 `status`(+`processing_started_at`), 일정은 `next_attempt_at`. 공용 판본에는 이미
 * `PROCESSING` 기반 lease 가 있었고 스펙도 붙어 있어서, 그것을 지우고 한 컬럼에 겹치는 것은
 * **없던 위험을 새로 만드는 쪽**이다: 롤링 배포 중 옛 디스패처(컬럼을 모른다)와 새 디스패처가
 * 겹치는 순간, `status` 가 계속 `PENDING` 인 행은 옛 쪽이 집어 가 이중 발행이 된다.
 * `PROCESSING` 은 옛 판본도 존중하므로 그 창이 열리지 않는다.
 */
@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private readonly config: Required<OutboxConfig>;
  private readonly publisherMap: Map<string, StreamPublisher>;

  constructor(
    private readonly dbService: DbService,
    publisherMap: Map<string, StreamPublisher>,
    config?: OutboxConfig,
    /**
     * 이 모듈이 등록하지 않은 토픽의 publisher 를 **파생 조회**하는 자리 (Task 6-C-2).
     *
     * 그 전까지 발행 가능한 토픽은 `enableOutbox` 를 켠 `forRoot` 호출의 `streams` 로
     * *선언*됐다. 그런데 아웃박스는 앱 하나에 테이블 하나이고 BC 별 `forRoot` 는 여럿이라,
     * 그 선언은 "이 앱이 적재하는 토픽 집합" 과 어긋난다 — core 가 그렇다: 아웃박스를 켠
     * 것은 catalog(`PRODUCT_STREAM`) 하나인데 적재는 5개 토픽이 더 한다. 어긋나면 조용하지
     * 않고 `No publisher found for topic` 으로 재시도를 소진한다.
     *
     * 선언을 늘리는 대신 파생한다 — ADR-0029 §1·§3 이 소비 집합에 적용한 것과 같은 원칙이다.
     * publisher 는 `@Global()` 모듈이 `getPublisherToken(topic)` 으로 등록하므로, 행이 들고
     * 있는 topic 이 곧 조회 키다.
     */
    private readonly resolvePublisher?: (topic: string) => StreamPublisher | undefined,
    /**
     * 발행을 일시 보류할 행을 고르는 게이트 (선택). 없으면 보류 없음 = 이 인자가 생기기 전 동작.
     */
    private readonly dispatchGate?: OutboxDispatchGate,
    /**
     * 나가는 봉투에 이 outbox DB 의 테넌트를 찍는다. 적재 때가 아니라 여기서 찍으므로 이미 쌓인 행도 찍힌다.
     * 없으면 행에 실린 봉투 그대로 보낸다 — `EventsModule.forApp` 은 테넌트 목록이 있는 앱에서 항상 넘긴다.
     */
    private readonly tenantStamp?: EventTenantStamp,
  ) {
    this.publisherMap = publisherMap;
    const retryDelaysSeconds = config?.retryDelaysSeconds ?? OUTBOX_RETRY_DELAYS_SECONDS;
    if (retryDelaysSeconds.length === 0 || retryDelaysSeconds.some((s) => !(s > 0))) {
      throw new Error('OutboxConfig.retryDelaysSeconds 는 양수 하나 이상이어야 한다 — 빈 표는 0초 재시도 폭주가 된다');
    }
    this.config = {
      dispatchIntervalMs: config?.dispatchIntervalMs ?? 5000,
      batchSize: config?.batchSize ?? 100,
      maxRetries: config?.maxRetries ?? 5,
      processingTimeoutMs: config?.processingTimeoutMs ?? 300_000,
      cleanupDays: config?.cleanupDays ?? 7,
      strictPartitionOrdering: config?.strictPartitionOrdering ?? false,
      retryDelaysSeconds,
      sequencedTopics: [...(config?.sequencedTopics ?? [])],
    };
  }

  private get db() {
    return this.dbService.db;
  }

  // cron-overlap-safe: acquireEventBatch 가 FOR UPDATE SKIP LOCKED 로 배치를 선점해 겹쳐도 같은 행을 두 번 못 잡는다 — CronOnceModule 없는 앱(notification·file-service·search)에서도 돌아야 하므로 @CronOnce 로 바꾸지 않는다(ADR-0036).
  @Cron('*/5 * * * * *')
  async dispatchPendingEvents() {
    try {
      await this.requeueStaleProcessingEvents();
      const events = await this.acquireEventBatch();

      if (events.length === 0) {
        return;
      }

      this.logger.log(`Processing ${events.length} outbox events`);

      for (const event of events) {
        await this.processEvent(event);
      }
    } catch (error) {
      this.logger.error('Dispatcher error:', error);
    }
  }

  private async acquireEventBatch() {
    return await this.db.transaction(async (tx) => {
      const now = new Date();
      const result = await tx
        .select({
          id: outbox_events.id,
          topic: outbox_events.topic,
          aggregateType: outbox_events.aggregateType,
          aggregateId: outbox_events.aggregateId,
          eventType: outbox_events.eventType,
          partitionKey: outbox_events.partitionKey,
          payload: outbox_events.payload,
          retryCount: outbox_events.retryCount,
          createdAt: outbox_events.createdAt,
        })
        .from(outbox_events)
        .where(
          and(
            eq(outbox_events.status, 'PENDING'),
            lt(outbox_events.retryCount, this.config.maxRetries),
            // 예약 백오프 (ADR-0029 §5-1). 이 조건이 없으면 실패한 행이 5초마다 즉시 재시도된다.
            lte(outbox_events.nextAttemptAt, now),
            // 보류는 **선택 단계**에서 건다 (Task 6-C-2). 고른 뒤 걸러내면 lease 를 잡아 놓고
            // 버리는 꼴이라, 보류된 행이 `PROCESSING` 에 갇혔다가 timeout 으로 회수된다.
            this.pauseCondition(),
            // 파티션 순서 보장도 같은 이유로 선택 단계에서 건다 (Task 6-C-3).
            this.partitionOrderCondition(),
            // 같은 주문의 순서 (#1016 7번, `sequencedTopics` 토픽만). 선택 단계에서 거는 이유는 위 두 조건과 같다.
            this.aggregateSequenceCondition(),
          ),
        )
        .orderBy(outbox_events.createdAt)
        .limit(this.config.batchSize)
        .for('update', { skipLocked: true });

      if (result.length === 0) {
        return [];
      }

      const ids = result.map((e) => e.id);

      // lease 를 잡는다. `retry_count` 는 여기서 올리지 않는다 — 증가 지점은 `handleFailure`
      // 하나뿐이라, 발행 도중 죽은 행이 재시도 횟수를 소모하지 않는다(core 판본의 성질).
      await tx
        .update(outbox_events)
        .set({ status: 'PROCESSING', processingStartedAt: now })
        .where(inArray(outbox_events.id, ids));

      return result;
    });
  }

  /**
   * 게이트가 보류를 원하면 그 행들을 **제외**하는 조건을 만든다. 보류가 없으면 `undefined` —
   * drizzle 의 `and()` 가 undefined 를 무시하므로 조건 자체가 사라진다.
   */
  private pauseCondition(): SQL | undefined {
    const paused = this.dispatchGate?.pausedRows();
    if (!paused) return undefined;

    const clauses: SQL[] = [];
    if (paused.topics?.length) {
      clauses.push(inArray(outbox_events.topic, paused.topics));
    }
    for (const prefix of paused.eventTypePrefixes ?? []) {
      // `ilike` 로 대소문자를 무시한다 — core 로컬 필터가 `LOWER(event_type) LIKE 'fulfillment%'`
      // 였고, 이벤트 이름의 대소문자 표기가 적재 지점마다 갈려 있었다.
      clauses.push(ilike(outbox_events.eventType, `${prefix}%`));
    }
    if (clauses.length === 0) return undefined;

    const matched = clauses.length === 1 ? clauses[0] : or(...clauses);
    return matched ? not(matched) : undefined;
  }

  /**
   * 같은 파티션의 **더 이른 미발행 행**이 있으면 후보에서 뺀다
   * (`strictPartitionOrdering`, Task 6-C-3). 꺼져 있으면 `undefined` — `and()` 가 무시하므로
   * 조건 자체가 사라진다 = 이 옵션이 생기기 전 동작.
   *
   * `(created_at, id)` 를 사전식으로 비교하는 것이 요점이다. `created_at` 만 보면 같은
   * 밀리초에 적재된 두 행이 서로를 막아 **파티션이 영구히 정지**한다 — 한 트랜잭션에서 두
   * 이벤트를 적재하면 실제로 같은 타임스탬프가 나온다. `id` 가 그 동률을 깬다.
   *
   * `PUBLISHED`/`FAILED` 는 막지 않는다. 최종 실패한 행이 뒤를 영원히 막으면 그 파티션은
   * 사람이 손대기 전까지 죽는데, 그건 순서 보장이 아니라 가용성 사고다. (wallet 로컬 판본도
   * `('PENDING','PROCESSING')` 만 봤다 — 같은 선택이다.)
   */
  private partitionOrderCondition(): SQL | undefined {
    if (!this.config.strictPartitionOrdering) return undefined;

    return sql`not exists (
      select 1
      from ${outbox_events} previous
      where previous.partition_key = ${outbox_events.partitionKey}
        and previous.status in ('PENDING', 'PROCESSING')
        and (
          previous.created_at < ${outbox_events.createdAt}
          or (previous.created_at = ${outbox_events.createdAt} and previous.id < ${outbox_events.id})
        )
    )`;
  }

  /**
   * `sequencedTopics` 토픽의 행은 같은 `(topic, aggregate_id)` 의 **더 이른** 미발행·굳은 행이 있으면 후보에서 뺀다
   * (#1016 7번, 스펙 §8.2). 목록 밖 토픽의 행은 조건의 첫 갈래(`topic not in`)로 그대로 통과한다. 목록이 비면 `undefined`.
   *
   * 키가 `partition_key` 가 아니라 `aggregate_id` 인 이유: channel-adapter 는 주문 이벤트의 파티션 키가 채널
   * 이름이라 그 키로 막으면 채널 전체가 멈춘다. 주문 하나를 가리키는 것은 `aggregate_id` 다.
   * `FAILED` 를 막는 것이 `partitionOrderCondition` 과 반대인 이유·토픽을 고르는 이유는 `OutboxConfig.sequencedTopics` 주석.
   * 인덱스는 더하지 않았다 — 조건이 미발행 상태만 보고 `PUBLISHED` 는 7일 뒤 지워지므로 작을 것으로 보지만 확인하지 않았다.
   * 배포 전 `EXPLAIN ANALYZE` 가 게이트다 (스펙 §11). 느리면 `(topic, aggregate_id, created_at)` 부분 인덱스를 더한다.
   */
  private aggregateSequenceCondition(): SQL | undefined {
    const topics = this.config.sequencedTopics;
    if (topics.length === 0) return undefined;

    return or(
      notInArray(outbox_events.topic, [...topics]),
      sql`not exists (
        select 1
        from ${outbox_events} previous
        where previous.topic = ${outbox_events.topic}
          and previous.aggregate_id = ${outbox_events.aggregateId}
          and previous.status in ('PENDING', 'PROCESSING', 'FAILED')
          and (
            previous.created_at < ${outbox_events.createdAt}
            or (previous.created_at = ${outbox_events.createdAt} and previous.id < ${outbox_events.id})
          )
      )`,
    );
  }

  /** 순서를 지키는 토픽 — `OutboxFailuresService` 가 «뒤에서 기다리는 수»를 셀 때 같은 목록을 쓴다 */
  get sequencedTopics(): readonly string[] {
    return this.config.sequencedTopics;
  }

  /**
   * lease 만료 회수. 발행 도중 프로세스가 죽으면 행이 `PROCESSING` 에 남으므로,
   * `processingTimeoutMs` 가 지난 것을 다시 `PENDING` 으로 돌린다.
   *
   * **`retryCount` 를 올리지 않고 `nextAttemptAt` 을 현재로 되돌린다** — 크래시는 페이로드의
   * 잘못이 아니므로 재시도 예산을 깎지도, 백오프로 미루지도 않는다. core 판본에서 lease 만료가
   * "attempts 증가 없이 재시도" 인 것과 같은 성질이다.
   */
  private async requeueStaleProcessingEvents() {
    const now = new Date();
    const threshold = new Date(now.getTime() - this.config.processingTimeoutMs);
    const timeoutSeconds = Math.floor(this.config.processingTimeoutMs / 1000);

    const stale = and(
      eq(outbox_events.status, 'PROCESSING'),
      or(isNull(outbox_events.processingStartedAt), lte(outbox_events.processingStartedAt, threshold)),
    );

    // 사람의 «다시 보내기»는 `FAILED → PROCESSING` 으로 lease 하되 `retry_count` 를 한도(maxRetries)에 둔 채로 둔다.
    // 그 도중 프로세스가 죽으면 PENDING 으로 되돌리면 안 된다 — acquire 가 `retry_count < maxRetries` 만 고르므로
    // 영영 선택되지 않고, FAILED 도 아니라 목록·다시 보내기·종결 어디에도 안 보이며, 같은 주문 뒤 행을 계속 막는다.
    // 그래서 한도에 닿은 행은 FAILED 로 돌려보낸다. 다른 앱 경로는 한도에 닿은 행을 lease 하지 않으므로 동작이 그대로다.
    const result = await this.db
      .update(outbox_events)
      .set({
        status: 'PENDING',
        processingStartedAt: null,
        nextAttemptAt: now,
        errorMessage: `Requeued after ${timeoutSeconds}s processing timeout`,
      })
      .where(and(stale, lt(outbox_events.retryCount, this.config.maxRetries)))
      .returning({ id: outbox_events.id });

    const backToFailed = await this.db
      .update(outbox_events)
      .set({
        status: 'FAILED',
        processingStartedAt: null,
        failedAt: now,
        errorMessage: `Requeued after ${timeoutSeconds}s processing timeout during manual resend`,
      })
      .where(stale)
      .returning({ id: outbox_events.id });

    if (backToFailed.length > 0) {
      this.logger.warn(`Returned ${backToFailed.length} stale manual-resend outbox events to FAILED`);
    }
    if (result.length > 0) {
      this.logger.warn(`Requeued ${result.length} stale outbox events`);
    }
  }

  /**
   * 토픽 → publisher. 이 모듈이 등록한 스트림을 먼저 보고, 없으면 앱 컨테이너에서 파생 조회한다.
   * 찾은 것은 map 에 넣어 다음 폴링부터 조회를 건너뛴다.
   */
  private publisherFor(topic: string): StreamPublisher | undefined {
    const known = this.publisherMap.get(topic);
    if (known) return known;

    const resolved = this.resolvePublisher?.(topic);
    if (resolved) this.publisherMap.set(topic, resolved);
    return resolved;
  }

  private async processEvent(event: OutboxDispatchRow) {
    try {
      await this.publishAndMark(event);
    } catch (error) {
      await this.handleFailure(event, error);
    }
  }

  /** 발행 + `PUBLISHED` 표시. 디스패처 주기와 사람의 «다시 보내기»가 같은 길을 탄다(검증 포함). */
  private async publishAndMark(event: OutboxDispatchRow): Promise<void> {
    const publisher = this.publisherFor(event.topic);

    if (!publisher) {
      throw new Error(`No publisher found for topic: ${event.topic}`);
    }

    // 검증을 탄다 (ADR-0029 §5). `enqueue` 를 지나지 않은 행 — 이 변경 이전에 적재된 PENDING
    // 행 — 이 스키마를 위반하면 여기서 실패로 기록되고 재시도 후 FAILED 로 남는다. 발행돼서
    // 소비자 DLQ 에 쌓이는 것보다 발행 측에 남는 편이 진단에 가깝다.
    //
    // partitionKey 는 ADR-0029 §5-1 로 승격된 컬럼이다. 비어 있으면 aggregateId 로 폴백하며,
    // 그것이 컬럼이 생기기 전의 동작이다 — 현재 적재기(`OutboxPublisher.write`)는 아직 이
    // 컬럼을 채우지 않으므로 라이브 동작은 그대로다.
    // `payload` 컬럼은 jsonb 라 drizzle 이 `unknown` 으로 준다. 이 행에 실린 것이 조립·검증을
    // 마친 envelope 라는 것은 적재 쪽(`OutboxWriter.write`)의 계약이므로 여기서 좁힌다.
    const stored = event.payload as MessageEnvelope;
    const envelope = this.tenantStamp?.stampOutbox(stored) ?? stored;
    await publisher.publishStoredEnvelope(envelope, event.partitionKey ?? event.aggregateId);

    await this.db
      .update(outbox_events)
      .set({
        status: 'PUBLISHED',
        processingStartedAt: null,
        publishedAt: new Date(),
      })
      .where(eq(outbox_events.id, event.id));

    recordOutboxPublished(event.topic);
    this.logger.log(`Event ${event.id} published: ${event.eventType}`);
  }

  /**
   * 사람이 선점(`FAILED → PROCESSING`)한 행을 **한 번** 보낸다 (#1016 7번, 스펙 §8.3). 실패하면 `FAILED` 로 되돌리고
   * 오류만 갱신한다 — `retry_count` 를 그대로 두는 이유는 다시 2시간 재시도 일정에 태우지 않기 위해서다.
   */
  async publishLeasedRow(event: OutboxDispatchRow): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.publishAndMark(event);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db
        .update(outbox_events)
        .set({ status: 'FAILED', processingStartedAt: null, errorMessage: message, failedAt: new Date() })
        .where(eq(outbox_events.id, event.id));
      recordOutboxFailed(event.topic, true);
      this.logger.error(`Event ${event.id} resend failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  /**
   * `retryCount` 가 증가하는 **유일한** 지점.
   */
  private async handleFailure(event: OutboxDispatchRow, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const newRetryCount = event.retryCount + 1;
    const isFinalFailure = newRetryCount >= this.config.maxRetries;

    await this.db
      .update(outbox_events)
      .set({
        status: isFinalFailure ? 'FAILED' : 'PENDING',
        processingStartedAt: null,
        retryCount: newRetryCount,
        errorMessage: message,
        failedAt: isFinalFailure ? new Date() : undefined,
        // 최종 실패 행은 acquire 의 `retryCount < maxRetries` 가 이미 배제하므로 예약하지 않는다.
        nextAttemptAt: isFinalFailure ? undefined : this.calculateNextAttempt(newRetryCount),
      })
      .where(eq(outbox_events.id, event.id));

    // `final` 은 이 행이 더 이상 디스패치되지 않는다는 뜻이다 — 곧 재시도될 실패와 한 시계열에
    // 섞이면 알람을 걸 수 없다.
    recordOutboxFailed(event.topic, isFinalFailure);
    this.logger.error(`Event ${event.id} failed (${newRetryCount}/${this.config.maxRetries}): ${message}`);
  }

  private calculateNextAttempt(retryCount: number): Date {
    const delay = nextAttemptDelaySeconds(retryCount, this.config.retryDelaysSeconds);
    return new Date(Date.now() + delay * 1000);
  }

  // cron-overlap-safe: PUBLISHED 행 DELETE 는 겹쳐도 같은 행을 다시 지우거나 0건일 뿐인 멱등 연산이다 — CronOnceModule 없는 앱에서도 돌아야 하므로 @CronOnce 로 바꾸지 않는다(ADR-0036).
  @Cron('0 2 * * *', { timeZone: 'Asia/Seoul' })
  async cleanupOldEvents() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.cleanupDays);

    const result = await this.db
      .delete(outbox_events)
      .where(and(eq(outbox_events.status, 'PUBLISHED'), lt(outbox_events.publishedAt, cutoffDate)))
      .returning({ id: outbox_events.id });

    this.logger.log(`Cleaned up ${result.length} old outbox events`);
  }
}
