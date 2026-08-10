/**
 * Consumer Decorators
 *
 * Stream 기반 이벤트 핸들러 데코레이터
 */

import { applyDecorators, SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { EventPattern, Payload, Ctx } from '@nestjs/microservices';
import { KafkaContext } from '@nestjs/microservices';
import { MessageEnvelope, DomainEvent, DomainCommand } from '@packages/event-contracts/types';
import type { EventKeysOf, StreamConfig, StreamEventTypes } from '@packages/event-contracts/types';

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
    eventTypes?: string[]; // 관심 있는 이벤트 타입 필터
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
 * 계약에서 토픽·이벤트명을 도출하는 핸들러 데코레이터 (ADR-0029 §4)
 *
 * 옛 표면 `@OnEvent('products.events.v1', 'ProductMasterDeleted')` 는 **두 개의 생문자열**
 * 이었다. 토픽은 계약이 이미 알고 있고(`STREAM.topic.topic`), 이벤트명은 계약이 가진 키
 * 집합에 속해야 한다. `@On` 은 토픽을 계약에서 읽고 이벤트명을 `EventKeysOf` 로 좁혀,
 * 오타가 **컴파일 에러**가 되게 한다. (`@OnEvent` 는 Task 7 에서 삭제됐다.)
 *
 * 남기는 런타임 메타데이터는 Nest 네이티브 그대로다 — `EventPattern(topic)` +
 * `SetMetadata(EVENT_TYPE_FILTER, eventName)`. 따라서 `EventTypeGuard` · 소비 집합
 * 도출(`consumer-discovery.ts`) · Nest 의 바인딩이 전부 그대로 동작한다.
 *
 * @example
 * @Controller()
 * @UseInterceptors(EventTypeGuard)
 * export class ProductEventsConsumer {
 *   @On(PRODUCT_STREAM, 'ProductMasterDeleted')
 *   async onDeleted(
 *     @EventEnvelope() envelope: EnvelopeOf<typeof PRODUCT_STREAM, 'ProductMasterDeleted'>,
 *     @EventPayload() payload: EventPayloadOf<typeof PRODUCT_STREAM, 'ProductMasterDeleted'>,
 *   ): Promise<void> {}
 * }
 */
export function On<S extends StreamConfig<StreamEventTypes>, K extends EventKeysOf<S> & string>(
  stream: S,
  eventName: K,
) {
  const topic = stream?.topic?.topic;

  if (typeof topic !== 'string' || topic.length === 0) {
    throw new Error(
      `@On(): 스트림에 토픽이 없다 (${JSON.stringify(topic)}). ` +
        'packages/event-contracts 의 stream() 으로 만든 StreamConfig 를 넘겨야 한다.',
    );
  }

  // 타입 단계에서 이미 좁혀지지만, `as any` 로 빠져나온 호출은 데코레이터 평가 시점
  // (= 부팅)에 죽인다. 조용히 통과하면 그 핸들러는 영원히 실행되지 않는다.
  if (!Object.prototype.hasOwnProperty.call(stream.events, eventName)) {
    throw new Error(
      `@On(): ${topic} 계약에 "${String(eventName)}" 이벤트가 없다. ` +
        `사용 가능한 이벤트: ${Object.keys(stream.events).join(', ')}`,
    );
  }

  return applyDecorators(EventPattern(topic), SetMetadata(EVENT_TYPE_FILTER, eventName));
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
export const EventEnvelope = createParamDecorator((data: unknown, ctx: ExecutionContext): MessageEnvelope => {
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
});

/**
 * Envelope에서 payload만 추출하는 파라미터 데코레이터
 *
 * @example
 * async handler(@EventPayload() payload: OrderCreatedPayload) {
 *   console.log(payload.orderId);
 *   console.log(payload.customerId);
 * }
 */
export const EventPayload = createParamDecorator((data: unknown, ctx: ExecutionContext): any => {
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
});

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
export const EventHeaders = createParamDecorator((data: unknown, ctx: ExecutionContext): Record<string, string> => {
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
});
