import { Gauge, register } from 'prom-client';

/**
 * 컨슈머 실패 관측 (#1016 8번, 스펙 §6.5). `events_outbox_failed_rows` 와 짝이고 알림 규칙의 대상이다.
 * 라벨은 `topic`·`status` 뿐 — `aggregate_id`·`event_type` 은 카디널리티 폭탄이다(`outbox.metrics.ts` 머리 주석).
 * 모듈 스코프 싱글턴인 이유는 `outbox.metrics.ts` 와 같다.
 */
const deadLettersGauge = new Gauge({
  name: 'events_dead_letters',
  help: 'Unresolved consumer dead letters in this app DB (status=failed is the head of a blocked sequence, held waits behind it)',
  labelNames: ['topic', 'status'],
  registers: [register],
});

export function setDeadLetterCount(topic: string, status: 'failed' | 'held', count: number): void {
  deadLettersGauge.set({ topic, status }, count);
}
