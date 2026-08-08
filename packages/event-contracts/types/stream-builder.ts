/**
 * Type-Safe Stream Builder Helpers
 *
 * 타입 안전한 Stream 정의를 위한 헬퍼 함수들
 */

import type { EventType, StreamConfig, StreamEventTypes } from './stream-config.types';
import type { ZodSchema } from './schema-validation.types';
import type { DomainEvent } from './envelope.types';

/**
 * 타입 안전한 이벤트 정의 헬퍼
 *
 * messageType을 리터럴 타입으로 강제하여 오타 방지
 *
 * @example
 * // 스키마 없이
 * const OrderCreated = event<'OrderCreated', OrderCreatedPayload>('OrderCreated');
 *
 * // 스키마와 함께
 * const OrderCreated = event('OrderCreated', OrderCreatedSchema);
 * type OrderCreatedPayload = z.infer<typeof OrderCreatedSchema>;
 */
export function event<TMessageType extends string, TPayload = unknown>(
  messageType: TMessageType,
  schema?: ZodSchema<TPayload>,
): EventType<TMessageType, TPayload> {
  return {
    messageType,
    schema,
  };
}

/**
 * Stream 정의 헬퍼 - 타입 안전성과 간결함을 모두 확보
 *
 * @example
 * export const ORDER_STREAM = stream({
 *   topic: 'orders.events.v1',
 *   partitions: 12,
 *   aggregateType: 'Order',
 *   events: {
 *     OrderCreated: event<'OrderCreated', OrderCreatedPayload>('OrderCreated'),
 *     OrderCancelled: event<'OrderCancelled', OrderCancelledPayload>('OrderCancelled'),
 *   }
 * });
 *
 * // 타입 추론됨
 * type Events = typeof ORDER_STREAM.events;
 * // => {
 * //   OrderCreated: EventType<'OrderCreated', OrderCreatedPayload>,
 * //   OrderCancelled: EventType<'OrderCancelled', OrderCancelledPayload>
 * // }
 */
type StreamDefinition<TEvents extends StreamEventTypes> = {
  topic: string;
  partitions?: number;
  dlqTopic?: string;
  aggregateType: string;
  events: TEvents;
};

export function stream<TEvents extends StreamEventTypes>(
  config: StreamDefinition<TEvents> & { partitionKey: (payload: any) => string },
): StreamConfig<TEvents> & { partitionKey: (payload: any) => string };
export function stream<TEvents extends StreamEventTypes>(config: StreamDefinition<TEvents>): StreamConfig<TEvents>;
export function stream<TEvents extends StreamEventTypes>(
  config: StreamDefinition<TEvents> & { partitionKey?: (payload: any) => string },
): StreamConfig<TEvents> {
  return {
    topic: {
      topic: config.topic,
      partitions: config.partitions,
      dlqTopic: config.dlqTopic,
    },
    aggregateType: config.aggregateType,
    events: config.events,
    partitionKey: config.partitionKey,
  };
}

/**
 * Stream에서 이벤트 키 타입 추출
 *
 * @example
 * type OrderEventKeys = EventKeysOf<typeof ORDER_STREAM>;
 * // => 'OrderCreated' | 'OrderCancelled' | ...
 */
export type EventKeysOf<TStream extends StreamConfig<any>> =
  TStream extends StreamConfig<infer TEvents> ? keyof TEvents : never;

/**
 * Stream에서 특정 이벤트의 Payload 타입 추출
 *
 * @example
 * type Payload = EventPayloadOf<typeof ORDER_STREAM, 'OrderCreated'>;
 * // => OrderCreatedPayload
 */
export type EventPayloadOf<TStream extends StreamConfig<any>, K extends EventKeysOf<TStream>> =
  TStream extends StreamConfig<infer TEvents>
    ? TEvents[K] extends EventType<any, infer TPayload>
      ? TPayload
      : never
    : never;

/**
 * Stream에서 특정 이벤트의 Envelope 타입 추출
 *
 * 소비 핸들러의 `@EventEnvelope()` 파라미터 주석이 계약에서 도출되게 한다.
 * `DomainEvent<EventPayloadOf<...>>` 를 매번 손으로 조합하는 대신 쓴다 —
 * 이 조합이 앱 전체에서 75곳에 나온다 (2026-08-09 실측).
 *
 * @example
 * async onCreated(@EventEnvelope() envelope: EnvelopeOf<typeof ORDER_STREAM, 'OrderCreated'>) {}
 */
export type EnvelopeOf<TStream extends StreamConfig<any>, K extends EventKeysOf<TStream>> = DomainEvent<
  EventPayloadOf<TStream, K>
>;

/**
 * Stream에서 특정 이벤트의 MessageType 추출
 *
 * @example
 * type MsgType = EventMessageTypeOf<typeof ORDER_STREAM, 'OrderCreated'>;
 * // => 'OrderCreated'
 */
export type EventMessageTypeOf<TStream extends StreamConfig<any>, K extends EventKeysOf<TStream>> =
  TStream extends StreamConfig<infer TEvents>
    ? TEvents[K] extends EventType<infer TMessageType, any>
      ? TMessageType
      : never
    : never;
