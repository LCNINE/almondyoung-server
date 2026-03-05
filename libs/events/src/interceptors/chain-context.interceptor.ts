import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { KafkaContext } from '@nestjs/microservices';
import { v7 } from 'uuid';
import { MessageEnvelope } from '@packages/event-contracts/types';
import { EventChainService } from '../tracking/event-chain.service';

/**
 * Kafka 메시지 수신 시 envelope에서 chainId/eventId를 CLS에 설정하는 인터셉터
 */
@Injectable()
export class ChainContextInterceptor implements NestInterceptor {
  constructor(private readonly eventChainService: EventChainService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() === 'http') {
      return next.handle();
    }

    try {
      const kafkaCtx = context.switchToRpc().getContext<KafkaContext>();
      const message = kafkaCtx.getMessage();
      const value = message.value;

      if (value) {
        const jsonString = Buffer.isBuffer(value)
          ? value.toString('utf-8')
          : String(value);
        const envelope = JSON.parse(jsonString) as MessageEnvelope;

        const chainId = envelope.chainId ?? v7();
        const eventId = envelope.messageId;

        this.eventChainService.setChainId(chainId);
        this.eventChainService.setEventId(eventId);
      }
    } catch {
      // 파싱 실패 시 무시 - 체인 추적은 베스트 에포트
    }

    return next.handle();
  }
}
