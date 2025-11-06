/**
 * Events Module - Public API
 *
 * Stream 기반 Kafka 이벤트 시스템
 */

// Core Types (re-exported from packages for backward compatibility)
export * from '@packages/event-contracts/types';

// Module
export * from './events.module';

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

// Utilities
export * from './utils/message-id.util';
