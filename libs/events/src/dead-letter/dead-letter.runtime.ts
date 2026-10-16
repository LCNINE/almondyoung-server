import { Injectable } from '@nestjs/common';
import type { Server } from '@nestjs/microservices';
import { dispatchToServerHandler } from '../transport/kafka-context.factory';
import { DEAD_LETTER_HEADERS, type DeadLetterRow } from './dead-letter.types';
import { DEAD_LETTER_MIGRATION_NAME } from './dead-letter-tables';

/**
 * 컨슈머 그룹과 마이크로서비스 서버를 붙든다 (#1016 8번, 스펙 §7.2). `startConsumer` 가 `attach` 한다 —
 * 그래서 `groupId` 의 정본은 `startConsumer` 인자 하나로 남는다.
 *
 * 테이블이 없으면(마이그 전 배포) `startConsumer` 가 붙이지 않는다 — 그 앱은 옛 `.dlq` 경로로 돌고, 이 런타임을 쓰는
 * API 는 «시작되지 않았다» 오류를 낸다.
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

  /** `startConsumer` 가 붙였는가. 안 붙었으면 실패 테이블 모드가 꺼져 있다(컨슈머 전이거나 테이블이 없다) */
  get isAttached(): boolean {
    return this.attached !== undefined;
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
        'DeadLetterRuntime: 실패 테이블 모드가 꺼져 있다 — ① main.ts 에서 startConsumer 가 app.listen 보다 먼저인지, ' +
          `② 마이그 \`${DEAD_LETTER_MIGRATION_NAME}\` 이 이 앱 DB 에 적용됐는지(없으면 startConsumer 가 ERROR 로그를 남기고 ` +
          '옛 .dlq 경로로 돈다 — db:migrate 후 재시작) 확인',
      );
    }
    return this.attached;
  }
}
