import { Inject, applyDecorators } from '@nestjs/common';
import { EventPattern, MessagePattern } from '@nestjs/microservices';
import { EventPublisherService, EVENT_PUBLISHER_CLIENT } from './event-publisher.service';
import { EventDefinition } from './types';

// Publisher 서비스 주입을 위한 데코레이터
export const InjectEventPublisher = () => Inject(EventPublisherService);

// Kafka 클라이언트 주입을 위한 데코레이터
export const InjectKafkaClient = () => Inject(EVENT_PUBLISHER_CLIENT);

// 타입 안전한 이벤트 핸들러 데코레이터
export function TypedEventPattern<
  TEvents extends Record<string, EventDefinition>,
  K extends keyof TEvents,
>(eventKey: K) {
  return applyDecorators(
    EventPattern(String(eventKey))
  );
}

// 타입 안전한 메시지 패턴 데코레이터 (Request-Response)
export function TypedMessagePattern<
  TEvents extends Record<string, EventDefinition>,
  K extends keyof TEvents,
>(eventKey: K) {
  return applyDecorators(
    MessagePattern(String(eventKey))
  );
}

// 이벤트 핸들러 메서드 시그니처를 위한 타입 헬퍼
export type EventHandler<
  TEvents extends Record<string, EventDefinition>,
  K extends keyof TEvents,
> = (payload: TEvents[K]['payload']) => Promise<void> | void;

// Request-Response 핸들러 메서드 시그니처를 위한 타입 헬퍼
export type MessageHandler<
  TEvents extends Record<string, EventDefinition>,
  K extends keyof TEvents,
  TResponse = any,
> = (payload: TEvents[K]['payload']) => Promise<TResponse> | TResponse; 