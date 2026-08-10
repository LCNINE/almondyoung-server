/**
 * Events Module - Public API
 *
 * Stream 기반 Kafka 이벤트 시스템
 */

// Core Types (re-exported from packages for backward compatibility)
export * from '@packages/event-contracts/types';

// Module
export * from './events.module';

// Kafka Config Builder
export { createKafkaConfigFromEnv } from './kafka-config.util';

// Transport Port + 어댑터 (ADR-0029 §7)
export * from './transport/transport.port';
export * from './transport/kafka.transport';
// 테스트 하네스 — 앱 스펙에서도 쓸 수 있게 공개 표면에 둔다
export * from './transport/in-memory.broker';
export * from './transport/in-memory.transport';
export * from './transport/in-memory.server';

// Publisher
export * from './publishers/stream-publisher.service';
// 계약에서 도출하는 유일한 주입 표면 (ADR-0029 §4). 옛 `@InjectStreamPublisher` 는
// Task 7 에서 삭제됐다. 회귀 방지: npm run audit:event-publishers
export * from './publishers/publisher-token';
export * from './publishers/inject-publisher';

// Consumer Decorators & Guards
export * from './consumers/decorators';
export * from './guards/event-type.guard';

// 소비 집합 도출 + 소비 인터셉터 배선 (ADR-0029 §3·§8)
export * from './consumers/consumer-discovery';
export * from './consumers/consumer-interceptors';

// DLQ
export * from './dlq/dlq.types';
export * from './dlq/dlq-handler.service';

// Retry & Auto DLQ
export * from './retry/retry-policy.types';
export * from './retry/retry-policy.decorator';

// Schema Validation (util and interceptor only, types are in packages)
export * from './validation/schema-validation.util';
export * from './interceptors/schema-validation.interceptor';

// Retry Interceptor (EventsModule.forApp 이 APP_INTERCEPTOR 로, startConsumer 가 마이크로서비스 스코프로 등록)
export * from './interceptors/event-retry.interceptor';

// Graceful Shutdown
export * from './shutdown/graceful-shutdown.service';

// Topic Bootstrap (MSK Serverless 등 auto-create 불가 환경)
export * from './bootstrap/topic-bootstrap.service';

// Outbox Pattern
export * from './outbox/outbox.schema';
export * from './outbox/outbox.types';
export * from './outbox/outbox-writer.port';
export * from './outbox/outbox-dispatch-gate.port';
export * from './outbox/outbox-publisher.service';
export * from './outbox/outbox-dispatcher.service';

// Utilities
export * from './utils/message-id.util';

// Chain Tracking
export { EventChainService } from './tracking/event-chain.service';
export { EventTrackingService, EVENT_TRACKING_SERVICE_NAME } from './tracking/event-tracking.service';
export { EventTraceReader } from './tracking/event-trace.reader';
export { EventTraceController } from './tracking/event-trace.controller';
export { trackingSchema } from './tracking/tracking.schema';
export type { CausedByResource } from './publishers/stream-publisher.service';
export type { TraceLink } from './tracking/event-trace.reader';
export type { TraceResponse } from './tracking/event-trace.controller';
export { EventTraceApiModule } from './tracking/event-trace-api.module';
