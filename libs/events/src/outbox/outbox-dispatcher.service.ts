import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import type { MessageEnvelope } from '@packages/event-contracts/types';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { outbox_events } from './outbox.schema';
import { OutboxConfig } from './outbox.types';
import type { OutboxDispatchGate } from './outbox-dispatch-gate.port';
import { eq, inArray, and, lt, lte, or, isNull, not, ilike, type SQL } from 'drizzle-orm';

/**
 * 실패 후 다음 시도까지의 대기(초). core 로컬 판본
 * (`apps/core/.../fulfillment/outbox/outbox-dispatcher.service.ts`)에서 그대로 승격했다.
 * `retryCount` 는 실패 **후** 값이므로 1회차 실패 → 10초, 2회차 → 30초, … 마지막 값이 상한이다.
 */
export const OUTBOX_RETRY_DELAYS_SECONDS = [10, 30, 60, 300] as const;

/**
 * `acquireEventBatch` 가 고른 한 행. select 투영과 같은 모양이며, 이 타입이 있어서
 * `processEvent`/`handleFailure` 가 `any` 를 받지 않아도 된다 — `partitionKey` 처럼 **없을 수도
 * 있는** 컬럼이 새로 생겼기 때문에, 옵셔널 여부를 타입이 말해 주는 편이 낫다.
 */
type AcquiredOutboxRow = {
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
  ) {
    this.publisherMap = publisherMap;
    this.config = {
      dispatchIntervalMs: config?.dispatchIntervalMs ?? 5000,
      batchSize: config?.batchSize ?? 100,
      maxRetries: config?.maxRetries ?? 5,
      processingTimeoutMs: config?.processingTimeoutMs ?? 300_000,
      cleanupDays: config?.cleanupDays ?? 7,
    };
  }

  private get db() {
    return this.dbService.db;
  }

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

    const result = await this.db
      .update(outbox_events)
      .set({
        status: 'PENDING',
        processingStartedAt: null,
        nextAttemptAt: now,
        errorMessage: `Requeued after ${timeoutSeconds}s processing timeout`,
      })
      .where(
        and(
          eq(outbox_events.status, 'PROCESSING'),
          or(isNull(outbox_events.processingStartedAt), lte(outbox_events.processingStartedAt, threshold)),
        ),
      )
      .returning({ id: outbox_events.id });

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

  private async processEvent(event: AcquiredOutboxRow) {
    try {
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
      await publisher.publishStoredEnvelope(event.payload as MessageEnvelope, event.partitionKey ?? event.aggregateId);

      await this.db
        .update(outbox_events)
        .set({
          status: 'PUBLISHED',
          processingStartedAt: null,
          publishedAt: new Date(),
        })
        .where(eq(outbox_events.id, event.id));

      this.logger.log(`Event ${event.id} published: ${event.eventType}`);
    } catch (error) {
      await this.handleFailure(event, error);
    }
  }

  /**
   * `retryCount` 가 증가하는 **유일한** 지점.
   */
  private async handleFailure(event: AcquiredOutboxRow, error: unknown) {
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

    this.logger.error(`Event ${event.id} failed (${newRetryCount}/${this.config.maxRetries}): ${message}`);
  }

  private calculateNextAttempt(retryCount: number): Date {
    const delay = OUTBOX_RETRY_DELAYS_SECONDS[Math.min(retryCount - 1, OUTBOX_RETRY_DELAYS_SECONDS.length - 1)];
    return new Date(Date.now() + delay * 1000);
  }

  @Cron('0 2 * * *')
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
