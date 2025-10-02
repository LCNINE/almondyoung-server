/**
 * Stream Configuration Types
 *
 * 도메인 스트림 기반 토픽 설정 타입들
 */

import type { ZodSchema } from './validation/schema-validation.types';

/**
 * Kafka 토픽 설정
 */
export interface StreamTopicConfig {
  topic: string;                       // 'orders.events.v1'
  dlqTopic?: string;                   // 'orders.events.v1.dlq' (자동 생성 가능)
  partitions?: number;                 // 파티션 수 (기본값: Kafka 설정)
  replicationFactor?: number;          // 복제 계수 (기본값: Kafka 설정)
}

/**
 * 이벤트 타입 정의
 *
 * TMessageType을 리터럴 타입으로 받아 타입 안전성 확보
 *
 * @example
 * import { z } from 'zod';
 *
 * const OrderCreatedSchema = z.object({
 *   orderId: z.string().uuid(),
 *   customerId: z.string().uuid(),
 * });
 *
 * type OrderCreatedPayload = z.infer<typeof OrderCreatedSchema>;
 *
 * type OrderCreatedEvent = EventType<'OrderCreated', OrderCreatedPayload>;
 * // => { messageType: 'OrderCreated'; schema?: ZodSchema<OrderCreatedPayload> }
 */
export interface EventType<
  TMessageType extends string = string,
  TPayload = unknown,
> {
  messageType: TMessageType;
  schema?: ZodSchema<TPayload>;        // Zod 스키마 (런타임 검증용, 선택)
}

/**
 * Stream의 모든 이벤트 타입들
 *
 * @example
 * type OrderEvents = {
 *   OrderCreated: EventType<'OrderCreated', OrderCreatedPayload>;
 *   OrderCancelled: EventType<'OrderCancelled', OrderCancelledPayload>;
 * }
 */
export type StreamEventTypes = Record<string, EventType<any, any>>;

/**
 * Payload 타입 추출 헬퍼
 */
export type ExtractPayloadType<T> = T extends EventType<any, infer TPayload>
  ? TPayload
  : never;

/**
 * MessageType 추출 헬퍼
 */
export type ExtractMessageType<T> = T extends EventType<infer TMessageType, any>
  ? TMessageType
  : never;

/**
 * Consumer 설정
 */
export interface ConsumerConfig {
  groupId: string;
  sessionTimeout?: number;             // ms (기본: 30000)
  heartbeatInterval?: number;          // ms (기본: 3000)
  maxPollInterval?: number;            // ms (기본: 300000)
  autoCommit?: boolean;                // 기본: false
  autoCommitInterval?: number;         // ms
}

/**
 * Stream 전체 설정
 *
 * 하나의 도메인 스트림(토픽)에 대한 완전한 설정
 *
 * @example
 * const ORDER_STREAM: StreamConfig<OrderEvents> = {
 *   topic: { topic: 'orders.events.v1', partitions: 12 },
 *   aggregateType: 'Order',
 *   events: {
 *     OrderCreated: { messageType: 'OrderCreated' },
 *     OrderCancelled: { messageType: 'OrderCancelled' }
 *   }
 * }
 */
export interface StreamConfig<TEvents extends StreamEventTypes = StreamEventTypes> {
  topic: StreamTopicConfig;
  aggregateType: string;               // 'Order', 'User', 'Stock'
  events: TEvents;

  // Consumer 설정 (선택, forConsumer()에서 사용)
  consumer?: ConsumerConfig;
}

/**
 * Kafka 연결 설정
 */
export interface KafkaConfig {
  clientId: string;
  brokers: string[];
  groupId?: string;

  // 보안 설정
  ssl?: boolean | {
    rejectUnauthorized?: boolean;
    ca?: string[];
    key?: string;
    cert?: string;
  };
  sasl?:
    | { mechanism: 'plain'; username: string; password: string }
    | { mechanism: 'scram-sha-256'; username: string; password: string }
    | { mechanism: 'scram-sha-512'; username: string; password: string }
    | { mechanism: 'aws'; authorizationIdentity: string; accessKeyId: string; secretAccessKey: string; sessionToken?: string }
    | { mechanism: 'oauthbearer'; oauthBearerProvider: () => Promise<{ value: string }> };

  // 재시도 설정
  retry?: {
    retries?: number;
    initialRetryTime?: number;
    multiplier?: number;
    maxRetryTime?: number;
  };
}

/**
 * 환경 변수 기반 Kafka 설정
 */
export interface KafkaEnvironmentConfig {
  KAFKA_CLIENT_ID: string;
  KAFKA_BROKERS: string;               // 콤마로 구분된 브로커 목록
  KAFKA_GROUP_ID?: string;

  // Confluent Cloud / MSK 등
  KAFKA_API_KEY?: string;
  KAFKA_API_SECRET?: string;

  // SSL 설정
  KAFKA_SSL?: string;                  // 'true' | 'false'
}

/**
 * Helper: 환경 변수를 KafkaConfig로 변환
 */
export function createKafkaConfigFromEnv(
  env: KafkaEnvironmentConfig,
  options?: {
    defaultRetries?: number;
    defaultGroupId?: string;
  },
): KafkaConfig {
  const config: KafkaConfig = {
    clientId: env.KAFKA_CLIENT_ID,
    brokers: env.KAFKA_BROKERS.split(',').map((b) => b.trim()),
    groupId: env.KAFKA_GROUP_ID || options?.defaultGroupId,

    retry: {
      retries: options?.defaultRetries || 5,
      initialRetryTime: 300,
      multiplier: 2,
      maxRetryTime: 30000,
    },
  };

  // SSL/SASL 설정 (Confluent Cloud 등)
  if (env.KAFKA_API_KEY && env.KAFKA_API_SECRET) {
    config.ssl = true;
    config.sasl = {
      mechanism: 'plain',
      username: env.KAFKA_API_KEY,
      password: env.KAFKA_API_SECRET,
    };
  } else if (env.KAFKA_SSL === 'true') {
    config.ssl = true;
  }

  return config;
}

/**
 * Helper: DLQ 토픽 이름 생성
 */
export function getDLQTopicName(originalTopic: string): string {
  return `${originalTopic}.dlq`;
}

/**
 * Helper: DLQ 토픽에서 원본 토픽 추출
 */
export function getOriginalTopicName(dlqTopic: string): string {
  return dlqTopic.replace(/\.dlq$/, '');
}
