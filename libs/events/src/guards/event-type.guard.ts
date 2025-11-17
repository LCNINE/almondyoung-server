/**
 * Event Type Filter Interceptor
 *
 * @OnEvent 데코레이터의 eventType 필터링을 처리
 * Guard 대신 Interceptor를 사용하여 조용히 필터링 (에러 없이)
 */

import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { KafkaContext } from '@nestjs/microservices';
import { Observable, of } from 'rxjs';
import { EVENT_TYPE_FILTER } from '../consumers/decorators';
import { MessageEnvelope } from '@packages/event-contracts/types';

@Injectable()
export class EventTypeGuard implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // HTTP 요청인 경우 바로 통과 (RPC 요청만 처리)
    if (context.getType() !== 'rpc') {
      return next.handle();
    }

    // @OnEvent에서 설정한 eventType 메타데이터 가져오기
    const expectedEventType = this.reflector.get<string>(
      EVENT_TYPE_FILTER,
      context.getHandler(),
    );

    // eventType이 설정되지 않았으면 필터링 없이 통과
    if (!expectedEventType) {
      return next.handle();
    }

    // Kafka 메시지에서 실제 eventType 추출
    const kafkaContext = context.switchToRpc().getContext<KafkaContext>();
    
    // kafkaContext가 유효한지 확인
    if (!kafkaContext || typeof kafkaContext.getMessage !== 'function') {
      return of(undefined); // 조용히 무시
    }
    const message = kafkaContext.getMessage();
    const value = message.value;

    if (!value) {
      return of(undefined); // 조용히 무시 (undefined 반환으로 정상 완료)
    }

    let envelope: MessageEnvelope;

    try {
      // 이미 객체면 그대로 사용
      if (typeof value === 'object' && !Buffer.isBuffer(value)) {
        envelope = value as MessageEnvelope;
      } else {
        // Buffer 또는 string인 경우 파싱
        const jsonString: string = Buffer.isBuffer(value)
          ? value.toString('utf-8')
          : String(value);
        envelope = JSON.parse(jsonString) as MessageEnvelope;
      }

      // messageType 비교
      if (envelope.messageType === expectedEventType) {
        return next.handle(); // 일치하면 핸들러 실행
      } else {
        return of(undefined); // 일치하지 않으면 조용히 무시 (undefined 반환으로 정상 완료)
      }
    } catch (error) {
      return of(undefined); // 파싱 에러도 조용히 무시
    }
  }
}

