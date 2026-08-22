import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { KafkaContext } from '@nestjs/microservices';
import { v7 } from 'uuid';
import { EventChainService } from '../tracking/event-chain.service';
import { parseEnvelope } from '../utils/envelope.util';

/**
 * Kafka 메시지 수신 시 envelope에서 chainId/eventId를 CLS에 설정하는 인터셉터
 *
 * **CLS 컨텍스트는 이 인터셉터가 열지 않는다.** `buildConsumerInterceptors` 가 최외곽에
 * 얹는 `ClsInterceptor` 가 연다 (#612). 그 배선이 없던 동안 아래 `set` 이 매번
 * "No CLS context available" 로 던졌고, 예외가 통째로 삼켜져 **완전 무증상**이었다 —
 * 그래서 이 catch 는 이제 로그를 남긴다.
 */
@Injectable()
export class ChainContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ChainContextInterceptor.name);

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
        const envelope = parseEnvelope(value);

        const chainId = envelope.chainId ?? v7();
        const eventId = envelope.messageId;

        this.eventChainService.setChainId(chainId);
        this.eventChainService.setEventId(eventId);
      }
    } catch (error) {
      // 체인 추적은 여전히 베스트 에포트다 — 메시지 처리를 막지 않는다. 다만 **조용히**
      // 넘어가지는 않는다. 이 자리의 침묵이 #612 를 배포된 채로 오래 살려둔 원인이다.
      this.logger.warn({
        msg: '이벤트 체인 컨텍스트 설정 실패 — chainId 전파가 이 메시지에서 끊긴다',
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return next.handle();
  }
}
