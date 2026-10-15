import { Injectable } from '@nestjs/common';
import type { Server } from '@nestjs/microservices';
import { dispatchToServerHandler } from '../transport/kafka-context.factory';
import { DEAD_LETTER_HEADERS, type DeadLetterRow } from './dead-letter.types';

/**
 * 컨슈머 그룹과 마이크로서비스 서버를 붙든다 (#1016 8번, 스펙 §7.2). `startConsumer` 가 `attach` 한다 —
 * 그래서 `groupId` 의 정본은 `startConsumer` 인자 하나로 남는다.
 */
@Injectable()
export class DeadLetterRuntime {
  private attached?: { consumerGroup: string; server: Server };

  attach(options: { consumerGroup: string; server: Server }): void {
    if (this.attached) {
      throw new Error('DeadLetterRuntime: startConsumer 가 두 번 불렸다 — 앱에 컨슈머는 하나다');
    }
    this.attached = options;
  }

  get consumerGroup(): string {
    return this.require().consumerGroup;
  }

  /**
   * 한 행을 그 앱의 실제 소비 파이프라인에 다시 태운다. Kafka 를 거치지 않으므로 다른 구독자는 아무것도 받지 않는다.
   * 결과(성공·실패)는 인터셉터가 그 행에 적는다(`executeRedrive`). 토픽 핸들러가 없으면 false.
   */
  async dispatch(row: DeadLetterRow): Promise<boolean> {
    const { server } = this.require();
    return dispatchToServerHandler(server, {
      topic: row.topic,
      partition: row.kafkaPartition,
      offset: row.kafkaOffset,
      key: row.sequenceKey ?? '',
      value: JSON.stringify(row.envelope),
      headers: { [DEAD_LETTER_HEADERS.id]: String(row.id), [DEAD_LETTER_HEADERS.handler]: row.handler },
      timestamp: String(Date.now()),
    });
  }

  private require(): { consumerGroup: string; server: Server } {
    if (!this.attached) {
      throw new Error(
        'DeadLetterRuntime: 컨슈머가 아직 시작되지 않았다 — main.ts 에서 startConsumer 가 app.listen 보다 먼저인지 확인',
      );
    }
    return this.attached;
  }
}
