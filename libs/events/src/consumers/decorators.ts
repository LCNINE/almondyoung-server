/**
 * Consumer Decorators
 *
 * Stream 기반 이벤트 핸들러 데코레이터
 */

import {
  applyDecorators,
  SetMetadata,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { EventPattern, Payload, Ctx } from '@nestjs/microservices';
import { KafkaContext } from '@nestjs/microservices';
import { MessageEnvelope, DomainEvent, DomainCommand } from '../envelope.types';

export const STREAM_EVENT_METADATA = 'STREAM_EVENT_METADATA';
export const EVENT_TYPE_FILTER = 'EVENT_TYPE_FILTER';

/**
 * Stream 이벤트 핸들러 데코레이터
 *
 * 특정 토픽의 모든 메시지를 수신하고 messageType별로 라우팅
 *
 * @example
 * @Controller()
 * export class OrderEventsConsumer {
 *   @StreamEventHandler('orders.events.v1')
 *   async handleOrderEvents(@Payload() message: KafkaMessage) {
 *     const envelope = JSON.parse(message.value.toString());
 *
 *     switch (envelope.messageType) {
 *       case 'OrderCreated':
 *         return this.handleOrderCreated(envelope);
 *       case 'OrderCancelled':
 *         return this.handleOrderCancelled(envelope);
 *     }
 *   }
 * }
 */
export function StreamEventHandler(
  topic: string,
  options?: {
    eventTypes?: string[];             // 관심 있는 이벤트 타입 필터
  },
) {
  return applyDecorators(
    EventPattern(topic),
    SetMetadata(STREAM_EVENT_METADATA, {
      topic,
      eventTypes: options?.eventTypes,
    }),
  );
}

/**
 * 특정 이벤트 타입만 처리하는 핸들러 (권장)
 *
 * 내부적으로 messageType 필터링을 자동으로 처리
 *
 * @example
 * @Controller()
 * export class OrderEventsConsumer {
 *   @OnEvent('orders.events.v1', 'OrderCreated')
 *   async onOrderCreated(
 *     @EventEnvelope() envelope: DomainEvent<OrderCreatedPayload>,
 *     @EventPayload() payload: OrderCreatedPayload,
 *     @EventContext() ctx: KafkaContext,
 *   ) {
 *     console.log('Order created:', payload.orderId);
 *   }
 *
 *   @OnEvent('orders.events.v1', 'OrderCancelled')
 *   async onOrderCancelled(
 *     @EventPayload() payload: OrderCancelledPayload
 *   ) {
 *     console.log('Order cancelled:', payload.orderId);
 *   }
 * }
 */
export function OnEvent(topic: string, eventType: string) {
  return applyDecorators(
    EventPattern(topic),
    SetMetadata(EVENT_TYPE_FILTER, eventType),
  );
}

/**
 * 전체 Envelope를 추출하는 파라미터 데코레이터
 *
 * @example
 * async handler(@EventEnvelope() envelope: DomainEvent<OrderCreatedPayload>) {
 *   console.log(envelope.messageId);
 *   console.log(envelope.correlationId);
 *   console.log(envelope.payload);
 * }
 */
export const EventEnvelope = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): MessageEnvelope => {
    const kafkaCtx = ctx.switchToRpc().getContext<KafkaContext>();
    const message = kafkaCtx.getMessage();
    const value = message.value;

    // null 체크
    if (!value) {
      throw new Error('Kafka message value is null or undefined');
    }

    // 이미 객체면 그대로 반환 (NestJS가 자동 파싱한 경우)
    if (typeof value === 'object' && !Buffer.isBuffer(value)) {
      return value as MessageEnvelope;
    }

    // Buffer 또는 string인 경우 파싱
    const jsonString: string = Buffer.isBuffer(value) ? value.toString('utf-8') : String(value);
    return JSON.parse(jsonString) as MessageEnvelope;
  },
);

/**
 * Envelope에서 payload만 추출하는 파라미터 데코레이터
 *
 * @example
 * async handler(@EventPayload() payload: OrderCreatedPayload) {
 *   console.log(payload.orderId);
 *   console.log(payload.customerId);
 * }
 */
export const EventPayload = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): any => {
    const kafkaCtx = ctx.switchToRpc().getContext<KafkaContext>();
    const message = kafkaCtx.getMessage();
    const value = message.value;

    if (!value) {
      throw new Error('Kafka message value is null or undefined');
    }

    let envelope: MessageEnvelope;

    // 이미 객체면 그대로 사용 (NestJS가 자동 파싱한 경우)
    if (typeof value === 'object' && !Buffer.isBuffer(value)) {
      envelope = value as MessageEnvelope;
    } else {
      // Buffer 또는 string인 경우 파싱
      const jsonString: string = Buffer.isBuffer(value) ? value.toString('utf-8') : String(value);
      envelope = JSON.parse(jsonString) as MessageEnvelope;
    }

    return envelope.payload;
  },
);

/**
 * Kafka Context를 추출하는 파라미터 데코레이터
 *
 * @example
 * async handler(@EventContext() ctx: KafkaContext) {
 *   const message = ctx.getMessage();
 *   const { offset, partition } = message;
 *   console.log(`Offset: ${offset}, Partition: ${partition}`);
 * }
 */
export const EventContext = () => Ctx();

/**
 * Event metadata (messageId, correlationId 등)만 추출
 *
 * @example
 * async handler(@EventMetadata() metadata: EventMetadata) {
 *   console.log('Message ID:', metadata.messageId);
 *   console.log('Correlation ID:', metadata.correlationId);
 *   console.log('Aggregate ID:', metadata.source.aggregateId);
 * }
 */
export const EventMetadata = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): Omit<MessageEnvelope, 'payload'> => {
    const kafkaCtx = ctx.switchToRpc().getContext<KafkaContext>();
    const message = kafkaCtx.getMessage();
    const value = message.value;

    if (!value) {
      throw new Error('Kafka message value is null or undefined');
    }

    let envelope: MessageEnvelope;

    // 이미 객체면 그대로 사용 (NestJS가 자동 파싱한 경우)
    if (typeof value === 'object' && !Buffer.isBuffer(value)) {
      envelope = value as MessageEnvelope;
    } else {
      // Buffer 또는 string인 경우 파싱
      const jsonString: string = Buffer.isBuffer(value) ? value.toString('utf-8') : String(value);
      envelope = JSON.parse(jsonString) as MessageEnvelope;
    }

    // payload 제외한 메타데이터만 반환
    const { payload, ...metadata } = envelope;
    return metadata;
  },
);

/**
 * Kafka 메시지 헤더 추출
 *
 * @example
 * async handler(@EventHeaders() headers: Record<string, string>) {
 *   console.log('Message Type:', headers['message-type']);
 *   console.log('Correlation ID:', headers['correlation-id']);
 * }
 */
export const EventHeaders = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): Record<string, string> => {
    const kafkaCtx = ctx.switchToRpc().getContext<KafkaContext>();
    const message = kafkaCtx.getMessage();
    const headers = message.headers || {};

    // Buffer를 string으로 변환
    const stringHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (Buffer.isBuffer(value)) {
        stringHeaders[key] = value.toString('utf-8');
      } else if (typeof value === 'string') {
        stringHeaders[key] = value;
      } else {
        stringHeaders[key] = String(value);
      }
    }

    return stringHeaders;
  },
);
