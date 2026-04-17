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

// Publisher
export * from './publishers/stream-publisher.service';

// Consumer Decorators & Guards
export * from './consumers/decorators';
export * from './guards/event-type.guard';

// DLQ
export * from './dlq/dlq.types';
export * from './dlq/dlq-handler.service';

// Retry & Auto DLQ
export * from './retry/retry-policy.types';
export * from './retry/retry-policy.decorator';
export * from './filters/events-exception.filter';

// Schema Validation (util and interceptor only, types are in packages)
export * from './validation/schema-validation.util';
export * from './interceptors/schema-validation.interceptor';

// Graceful Shutdown
export * from './shutdown/graceful-shutdown.service';

// Topic Bootstrap (MSK Serverless 등 auto-create 불가 환경)
export * from './bootstrap/topic-bootstrap.service';

// Outbox Pattern
export * from './outbox/outbox.schema';
export * from './outbox/outbox.types';
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
