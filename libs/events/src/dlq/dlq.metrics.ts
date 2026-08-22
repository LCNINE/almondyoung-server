import { Counter, register } from 'prom-client';

/**
 * DLQ 관측 메트릭 — 모듈 스코프 싱글턴.
 *
 * DLQHandler 는 EventsModule 에서 2곳(events.module.ts:109, :255)에서 프로바이드되므로,
 * 카운터를 인스턴스 필드로 두면 두 번째 생성 시 prom-client 전역 register 중복 등록
 * 예외가 난다. 모듈 스코프 싱글턴이면 인스턴스 수와 무관하게 1회만 등록된다.
 *
 * 관측 커버리지: 전역 register 는 프로세스 단위다. `@app/events` 를 쓰는 앱 9개가 각자
 * `/metrics` 를 별도 포트(앱포트+10000)에 띄우고 Alloy 가 `discovery.dns` 로 9개 전부
 * 스크레이프하므로(2026-08-23, `docs/superpowers/specs/2026-08-22-observability-metrics-endpoints-design.md`),
 * Core 프로세스뿐 아니라 9개 앱 각각의 DLQ 가 독립적으로 관측된다. "Core 뿐"은 옛 서술이다.
 */

/** DLQ 로 발행 성공한 메시지 누적 수 — 조용히 유실되던 케이스의 관측 지점. */
export const dlqMessagesTotal = new Counter({
  name: 'events_dlq_messages_total',
  help: 'Messages routed to a dead-letter queue after retries were exhausted or the error was non-retryable',
  labelNames: ['topic', 'consumer', 'error'],
  registers: [register],
});

/** DLQ 발행 자체가 실패한 수 — offset 미커밋→무한 재전달로 이어지는 치명 케이스. */
export const dlqSendFailuresTotal = new Counter({
  name: 'events_dlq_send_failures_total',
  help: 'Failures to deliver a message to its dead-letter queue (offset not committed, message will be redelivered)',
  labelNames: ['topic', 'consumer'],
  registers: [register],
});
