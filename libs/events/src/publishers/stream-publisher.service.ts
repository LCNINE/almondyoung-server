/**
 * Stream Publisher Service
 *
 * 도메인 스트림 기반 이벤트/커맨드 발행
 */

import { Injectable, Inject, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { CompressionTypes } from 'kafkajs';
import { firstValueFrom } from 'rxjs';
import {
  DomainEvent,
  DomainCommand,
  MessageEnvelope,
} from '../envelope.types';
import { StreamConfig, StreamEventTypes, EventType } from '../stream-config.types';
import { generateMessageId } from '../utils/message-id.util';
import {
  SchemaValidationOptions,
  DEFAULT_SCHEMA_VALIDATION_OPTIONS,
} from '../validation/schema-validation.types';
import {
  validateSchemaOrThrow,
  logValidationError,
  isZodSchema,
} from '../validation/schema-validation.util';

/**
 * 이벤트 발행 파라미터 (타입 안전 버전)
 */
export interface PublishEventParams<
  TEventKey extends string,
  TPayload,
> {
  eventType: TEventKey;
  aggregateId: string;
  payload: TPayload;

  // 선택 사항
  aggregateVersion?: number;
  correlationId?: string;
  causationId?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * 커맨드 발행 파라미터 (타입 안전 버전)
 */
export interface PublishCommandParams<
  TCommandKey extends string,
  TPayload,
> {
  commandType: TCommandKey;
  aggregateId: string;
  payload: TPayload;

  // 선택 사항
  expiresIn?: number;                  // ms
  correlationId?: string;
  causationId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class StreamPublisher<
  TEvents extends StreamEventTypes = StreamEventTypes,
> {
  private readonly logger: Logger;
  private readonly validationOptions: Required<SchemaValidationOptions>;

  constructor(
    private readonly kafkaClient: ClientKafka,
    private readonly streamConfig: StreamConfig<TEvents>,
    private readonly serviceName: string,
    validationOptions?: SchemaValidationOptions,
  ) {
    this.logger = new Logger(
      `StreamPublisher:${streamConfig.topic.topic}`,
    );
    this.validationOptions = {
      ...DEFAULT_SCHEMA_VALIDATION_OPTIONS,
      ...validationOptions,
    };
  }

  /**
   * 도메인 이벤트 발행 (타입 안전)
   *
   * @example
   * await publisher.publishEvent({
   *   eventType: 'OrderCreated',  // ← 자동완성됨, 오타 시 컴파일 에러
   *   aggregateId: 'ORD-123',
   *   payload: { orderId: 'ORD-123', customerId: 'USR-456', ... },
   * });
   */
  async publishEvent<K extends keyof TEvents & string>(
    params: PublishEventParams<
      K,
      TEvents[K] extends EventType<any, infer TPayload> ? TPayload : never
    >,
  ): Promise<void> {
    const messageId = generateMessageId();
    const now = new Date();

    // 스키마 검증 (활성화된 경우)
    let validatedPayload = params.payload;
    if (this.validationOptions.validateOnPublish) {
      validatedPayload = this.validatePayload(
        String(params.eventType),
        params.payload,
      );
    }

    // Envelope 생성
    const envelope: DomainEvent<
      TEvents[K] extends EventType<any, infer TPayload> ? TPayload : never
    > = {
      messageId,
      messageType: String(params.eventType),
      messageVersion: 1,
      messageKind: 'event',

      correlationId: params.correlationId || messageId,
      causationId: params.causationId,

      timestamp: now.toISOString(),
      occurredAt: (params.occurredAt || now).toISOString(),

      source: {
        service: this.serviceName,
        aggregateType: this.streamConfig.aggregateType,
        aggregateId: params.aggregateId,
        aggregateVersion: params.aggregateVersion,
      },

      payload: validatedPayload,
      metadata: params.metadata,
    };

    await this.sendMessage(envelope, params.aggregateId);
  }

  /**
   * 배치 이벤트 발행
   *
   * @example
   * await publisher.publishEvents([
   *   { eventType: 'OrderCreated', aggregateId: 'ORD-123', payload: {...} },
   *   { eventType: 'OrderCreated', aggregateId: 'ORD-124', payload: {...} },
   * ]);
   */
  async publishEvents<K extends keyof TEvents & string>(
    events: Array<
      PublishEventParams<
        K,
        TEvents[K] extends EventType<any, infer TPayload> ? TPayload : never
      >
    >,
  ): Promise<void> {
    await Promise.all(events.map((event) => this.publishEvent(event)));
  }

  /**
   * 도메인 명령 발행 (Command 패턴)
   *
   * @example
   * await publisher.publishCommand({
   *   commandType: 'ProcessOrder',
   *   aggregateId: 'ORD-123',
   *   payload: { orderId: 'ORD-123' },
   *   expiresIn: 60000, // 1분
   * });
   */
  async publishCommand<K extends keyof TEvents & string>(
    params: PublishCommandParams<
      K,
      TEvents[K] extends EventType<any, infer TPayload> ? TPayload : never
    >,
  ): Promise<void> {
    const messageId = generateMessageId();
    const now = new Date();

    const envelope: DomainCommand<
      TEvents[K] extends EventType<any, infer TPayload> ? TPayload : never
    > = {
      messageId,
      messageType: String(params.commandType),
      messageVersion: 1,
      messageKind: 'command',

      correlationId: params.correlationId || messageId,
      causationId: params.causationId,

      timestamp: now.toISOString(),

      source: {
        service: this.serviceName,
        aggregateType: this.streamConfig.aggregateType,
        aggregateId: params.aggregateId,
      },

      payload: params.payload,
      metadata: params.metadata,

      expiresAt: params.expiresIn
        ? new Date(Date.now() + params.expiresIn).toISOString()
        : undefined,
    };

    await this.sendMessage(envelope, params.aggregateId);
  }

  /**
   * Kafka로 메시지 전송 (내부 메서드)
   */
  private async sendMessage(
    envelope: MessageEnvelope,
    partitionKey: string,
  ): Promise<void> {
    const topic = this.streamConfig.topic.topic;

    try {
      await firstValueFrom(
        this.kafkaClient.emit(topic, {
          key: partitionKey,               // 파티션 키 (순서 보장)
          value: JSON.stringify(envelope),
          compression: CompressionTypes.GZIP,  // 압축
          headers: {
            'message-id': envelope.messageId,
            'message-type': envelope.messageType,
            'message-kind': envelope.messageKind,
            'aggregate-type': envelope.source.aggregateType,
            'aggregate-id': envelope.source.aggregateId,
            'correlation-id': envelope.correlationId,
            'timestamp': envelope.timestamp,
          },
        }),
      );

      this.logger.debug(`📤 ${envelope.messageKind} published: ${envelope.messageType}`, {
        messageId: envelope.messageId,
        aggregateId: envelope.source.aggregateId,
        correlationId: envelope.correlationId,
      });
    } catch (error) {
      this.logger.error(
        `❌ Failed to publish ${envelope.messageKind}: ${envelope.messageType}`,
        {
          error: error instanceof Error ? error.message : String(error),
          messageId: envelope.messageId,
          aggregateId: envelope.source.aggregateId,
        },
      );
      throw error;
    }
  }

  /**
   * 토픽 정보 조회
   */
  getTopicInfo(): {
    topic: string;
    aggregateType: string;
    eventTypes: string[];
  } {
    return {
      topic: this.streamConfig.topic.topic,
      aggregateType: this.streamConfig.aggregateType,
      eventTypes: Object.keys(this.streamConfig.events),
    };
  }

  /**
   * Payload 스키마 검증 (내부 메서드)
   */
  private validatePayload<T>(eventType: string, payload: T): T {
    const eventConfig = this.streamConfig.events[eventType];

    if (!eventConfig) {
      this.logger.warn(`Event type not found in stream config: ${eventType}`);
      return payload;
    }

    const schema = eventConfig.schema;

    // 스키마가 없으면 검증 생략
    if (!schema || !isZodSchema(schema)) {
      return payload;
    }

    try {
      // 스키마 검증 수행
      const validatedPayload = validateSchemaOrThrow(
        schema,
        payload,
        `${this.streamConfig.topic.topic}.${eventType}`,
      );

      this.logger.debug(`✅ Schema validation passed: ${eventType}`);

      return validatedPayload;
    } catch (error) {
      if (this.validationOptions.throwOnValidationError) {
        // 에러를 다시 던짐
        throw error;
      } else {
        // 경고만 로깅하고 원본 payload 반환
        this.logger.warn(
          `⚠️  Schema validation failed but throwOnValidationError is false: ${eventType}`,
        );
        return payload;
      }
    }
  }
}
