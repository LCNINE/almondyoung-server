import { Gauge, register } from 'prom-client';

/**
 * Kafka consumer lag 메트릭 — **계기 정의가 사는 유일한 파일**이다 (#815, #712 관례).
 *
 * 파사드인 이유는 `outbox.metrics.ts` 와 같다 — #711 이 `prom-client` 를 OTel Meter 로 옮길 때
 * 손댈 파일을 하나로 가둔다. 모듈 스코프 싱글턴인 이유도 같다(전역 register 중복 등록 예외).
 *
 * **라벨은 `group` · `topic` · `partition` 셋이다.** `partition` 을 넣은 근거(#815):
 * - 한 파티션만 막히는 전형적 장애가 `topic × group` 합계에 묻힌다
 * - 시리즈 수는 그룹별 구독 토픽의 파티션 합 = 선언 기준 전체 204, 앱당 최대 84 (channel-adapter).
 *   Node 기본 계기 하나 수준이다. 라이브 실제 수는 이보다 클 수 없다 — `createTopics` 는 기존
 *   토픽의 파티션을 늘리지 않는다
 * - `fetchOffsets` 응답이 어차피 파티션 단위라 브로커 비용은 같다. 합은 `sum by (group, topic)`
 *
 * **값의 뜻**: `high watermark − committed offset`. 커밋 오프셋이 없는 파티션(브로커가 `-1` 을
 * 준다)은 **`-1` 그대로** 쓴다 — 0 으로 바꾸면 「가입했지만 한 번도 커밋하지 못함」이 영원히
 * 정상으로 보인다. 알림은 `> 0` 으로 건다.
 */

const lagGauge = new Gauge({
  name: 'events_consumer_lag',
  help: 'Kafka consumer lag per partition (high watermark - committed offset); -1 when the group has no committed offset',
  labelNames: ['group', 'topic', 'partition'],
  registers: [register],
});

/** 이미 시리즈를 세운 `group|topic` — 재초기화가 살아 있는 값을 0 으로 되돌리는 것을 막는다. */
const initializedTopics = new Set<string>();

function key(group: string, topic: string): string {
  return `${group}|${topic}`;
}

/**
 * `partitions` 개의 파티션에 0 시리즈를 세운다.
 *
 * 라벨 붙은 계기는 값을 한 번도 안 쓰면 시리즈가 없다(#712). 폴러가 브로커에 닿기 전에도,
 * 아예 못 닿아도 시리즈가 서 있어야 "lag 0" 과 "관측이 죽음" 이 구별된다.
 */
export function initConsumerLagSeries(group: string, topic: string, partitions: number): void {
  if (initializedTopics.has(key(group, topic))) return;
  initializedTopics.add(key(group, topic));

  for (let partition = 0; partition < partitions; partition += 1) {
    lagGauge.set({ group, topic, partition: String(partition) }, 0);
  }
}

export function setConsumerLag(group: string, topic: string, partition: number, lag: number): void {
  lagGauge.set({ group, topic, partition: String(partition) }, lag);
}

/** 선언보다 실제 파티션이 적을 때 초과분의 시리즈를 지운다 — 남겨 두면 거짓 0 이 영원히 선다. */
export function dropConsumerLagSeries(group: string, topic: string, partition: number): void {
  lagGauge.remove({ group, topic, partition: String(partition) });
}
