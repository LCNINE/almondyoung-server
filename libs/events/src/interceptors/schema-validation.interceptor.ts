/**
 * Schema Validation Interceptor
 *
 * Consumer에서 수신한 메시지의 스키마를 검증
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { KafkaContext } from '@nestjs/microservices';
import { Reflector } from '@nestjs/core';
import { MessageEnvelope } from '@packages/event-contracts/types';
import { StreamConfig, StreamEventTypes } from '@packages/event-contracts/types';
import {
  SchemaValidationOptions,
  DEFAULT_SCHEMA_VALIDATION_OPTIONS,
  SchemaValidationError,
} from '@packages/event-contracts/types';
import {
  validateSchemaOrThrow,
  isZodSchema,
  formatValidationErrors,
} from '../validation/schema-validation.util';
import { EVENT_TYPE_FILTER } from '../consumers/decorators';

@Injectable()
export class SchemaValidationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SchemaValidationInterceptor.name);
  private readonly validationOptions: Required<SchemaValidationOptions>;
  private readonly streamConfigMap: Map<string, StreamConfig>;

  constructor(
    private readonly reflector: Reflector,
    streams: StreamConfig[],
    validationOptions?: SchemaValidationOptions,
  ) {
    this.validationOptions = {
      ...DEFAULT_SCHEMA_VALIDATION_OPTIONS,
      ...validationOptions,
    };

    // topic -> StreamConfig 매핑
    this.streamConfigMap = new Map(
      streams.map((stream) => [stream.topic.topic, stream]),
    );
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // 스키마 검증이 비활성화된 경우 바로 통과
    if (!this.validationOptions.validateOnConsume) {
      return next.handle();
    }

    const ctx = context.switchToRpc();
    const kafkaContext = ctx.getContext<KafkaContext>();
    const topic = kafkaContext.getTopic();

    try {
      // Stream Config 조회
      const streamConfig = this.streamConfigMap.get(topic);
      if (!streamConfig) {
        this.logger.warn(`Stream config not found for topic: ${topic}`);
        return next.handle();
      }

      // 메시지 파싱
      const message = kafkaContext.getMessage();
      const value = message.value;
      if (!value) {
        throw new Error('Kafka message value is null or undefined');
      }
      const jsonString: string = Buffer.isBuffer(value)
        ? value.toString('utf-8')
        : String(value);
      const envelope = JSON.parse(jsonString) as MessageEnvelope;

      // 이벤트 타입별 스키마 검증
      const eventType = envelope.messageType;
      const eventConfig = streamConfig.events[eventType];

      if (!eventConfig) {
        this.logger.warn(
          `Event type not found in stream config: ${eventType}`,
          { topic },
        );
        return next.handle();
      }

      const schema = eventConfig.schema;

      // 스키마가 없으면 검증 생략
      if (!schema || !isZodSchema(schema)) {
        return next.handle();
      }

      // 스키마 검증 수행
      try {
        validateSchemaOrThrow(
          schema,
          envelope.payload,
          `${topic}.${eventType} (consumer)`,
        );

        this.logger.debug(`✅ Consumer schema validation passed: ${eventType}`, {
          topic,
          messageId: envelope.messageId,
        });
      } catch (error) {
        if (error instanceof SchemaValidationError) {
          this.logger.error(
            `❌ Consumer schema validation failed: ${eventType}`,
            {
              topic,
              messageId: envelope.messageId,
              errors: formatValidationErrors(error.errors),
            },
          );

          if (this.validationOptions.throwOnValidationError) {
            // 에러를 던지면 Exception Filter가 처리함 (DLQ로 전송)
            throw error;
          } else {
            this.logger.warn(
              `⚠️  Schema validation failed but throwOnValidationError is false`,
            );
          }
        } else {
          throw error;
        }
      }
    } catch (error) {
      // 파싱 에러 등
      if (error instanceof SchemaValidationError) {
        throw error;
      }

      this.logger.error(`Schema validation interceptor error`, {
        error: error instanceof Error ? error.message : String(error),
        topic,
      });

      // 다른 에러는 그대로 던짐
      throw error;
    }

    return next.handle();
  }
}

