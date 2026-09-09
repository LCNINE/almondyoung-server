import { Counter, Gauge, register } from 'prom-client';

/**
 * 아웃박스 관측 메트릭 — **계기 정의가 사는 유일한 파일**이다 (#712).
 *
 * 왜 파사드인가: #711 이 계기를 `prom-client` 에서 OTel Meter 로 옮긴다. 호출부가 계기 객체를
 * 직접 만지면 그때 손댈 파일이 호출부 수만큼 늘어난다. 여기서 함수로 가려 두면 포팅 표면이
 * **이 파일 하나**다. `MetricsService` 가 core 에서 같은 이유로 파사드인 것과 같다.
 *
 * 모듈 스코프 싱글턴인 이유는 `dlq.metrics.ts` 와 같다 — 계기를 인스턴스 필드로 두면 모듈이
 * 두 번 프로바이드될 때 전역 register 중복 등록 예외가 난다.
 *
 * **라벨은 `topic` 과 `final` 뿐이다.** `aggregate_id`·`event_type` 은 절대 라벨로 쓰지 않는다 —
 * #706 이 지운 `wms_available_stock`(`sku_id` × `warehouse_id`) 과 같은 카디널리티 폭탄이 된다.
 * `topic` 은 앱이 선언한 스트림 집합이라 닫혀 있고, `final` 은 두 값뿐이다.
 */

const pendingGauge = new Gauge({
  name: 'events_outbox_pending',
  help: 'Outbox rows waiting to be dispatched (status=PENDING)',
  labelNames: ['topic'],
  registers: [register],
});

const failedRowsGauge = new Gauge({
  name: 'events_outbox_failed_rows',
  help: 'Outbox rows that exhausted their retries and are no longer dispatched (status=FAILED)',
  labelNames: ['topic'],
  registers: [register],
});

/**
 * 적체의 **나이**. 개수보다 이쪽이 낫다 — 100건이 1초째면 정상이고 3건이 1시간째면 사고다.
 *
 * **토픽별인 이유** (#712 본문은 라벨 없음이었다): 라벨이 없으면 값이 전 토픽의 최댓값이라
 * 한 토픽이 막히는 순간 그 값에 고정돼 **다른 토픽의 적체가 영원히 가려진다.** 로컬 core DB
 * 에서 실제로 그랬다 — 30일 묵은 PENDING 17건이 나머지를 전부 덮었다. 전역값이 필요하면
 * PromQL `max(events_outbox_oldest_pending_age_seconds)` 로 복원한다.
 */
const oldestPendingAgeGauge = new Gauge({
  name: 'events_outbox_oldest_pending_age_seconds',
  help: 'Age of the oldest PENDING outbox row for this topic (0 when nothing is pending)',
  labelNames: ['topic'],
  registers: [register],
});

/** 같은 이유로 토픽별이다. 전역 합은 `sum(events_outbox_retry_pending)`. */
const retryPendingGauge = new Gauge({
  name: 'events_outbox_retry_pending',
  help: 'PENDING outbox rows for this topic that have already failed at least once (retry_count > 0)',
  labelNames: ['topic'],
  registers: [register],
});

const publishedTotal = new Counter({
  name: 'events_outbox_published_total',
  help: 'Outbox rows successfully published to the broker',
  labelNames: ['topic'],
  registers: [register],
});

/**
 * `final="true"` 는 `maxRetries` 를 소진해 행이 `FAILED` 로 죽은 경우다. 이 라벨이 없으면
 * 영구 실패와 곧 재시도될 실패가 한 시계열에 섞여 알람을 걸 수 없다.
 */
const failedTotal = new Counter({
  name: 'events_outbox_failed_total',
  help: 'Outbox dispatch failures (final=true means the row exhausted its retries)',
  labelNames: ['topic', 'final'],
  registers: [register],
});

/**
 * 이미 시리즈를 만든 토픽. **재초기화가 살아 있는 게이지를 0 으로 되돌리는 것**을 막는다 —
 * collector 가 매 tick 마다 알려진 토픽을 순회하므로 이 가드가 없으면 매번 값이 지워진다.
 */
const initializedTopics = new Set<string>();

/**
 * 토픽의 시리즈를 0 으로 만든다.
 *
 * 라벨 붙은 계기는 **한 번도 증가하지 않으면 시리즈 자체가 없다**. 그것이 `events_dlq_*` 두 개가
 * 있으나 마나였던 이유이고(#712), 여기서 같은 실수를 반복하지 않으려면 아웃박스가 비어 있는
 * 평상시에도 0 시리즈가 서 있어야 한다. 그래야 "적체 0" 과 "관측이 죽음" 이 구별된다.
 */
export function initOutboxTopicSeries(topic: string): void {
  if (initializedTopics.has(topic)) return;
  initializedTopics.add(topic);

  pendingGauge.set({ topic }, 0);
  failedRowsGauge.set({ topic }, 0);
  oldestPendingAgeGauge.set({ topic }, 0);
  retryPendingGauge.set({ topic }, 0);
  // 카운터는 0 만큼 늘려서 시리즈를 만든다 — `set` 이 없는 계기라 이것이 관례다.
  publishedTotal.inc({ topic }, 0);
  failedTotal.inc({ topic, final: 'true' }, 0);
  failedTotal.inc({ topic, final: 'false' }, 0);
}

export function setOutboxPending(topic: string, count: number): void {
  pendingGauge.set({ topic }, count);
}

export function setOutboxFailedRows(topic: string, count: number): void {
  failedRowsGauge.set({ topic }, count);
}

/** 정상 실행에서도 0 을 명시적으로 쓴다 — 안 그러면 적체가 해소된 뒤 낡은 값이 남는다. */
export function setOutboxOldestPendingAge(topic: string, seconds: number): void {
  oldestPendingAgeGauge.set({ topic }, seconds);
}

/** 정상 실행에서도 0 을 명시적으로 쓴다 — `setLedgerDrift` 계열과 같은 관례다. */
export function setOutboxRetryPending(topic: string, count: number): void {
  retryPendingGauge.set({ topic }, count);
}

export function recordOutboxPublished(topic: string): void {
  publishedTotal.inc({ topic });
}

export function recordOutboxFailed(topic: string, isFinal: boolean): void {
  failedTotal.inc({ topic, final: isFinal ? 'true' : 'false' });
}
