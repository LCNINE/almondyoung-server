import { Injectable } from '@nestjs/common';
import type { Server } from '@nestjs/microservices';
import { dispatchToServerHandler } from '../transport/kafka-context.factory';
import { DEAD_LETTER_HEADERS, type DeadLetterRow } from './dead-letter.types';
import { DEAD_LETTER_MIGRATION_NAME } from './dead-letter-tables';
import { eventTenancy } from '@packages/event-contracts/streams/registry';
import { asRecord, stampEnvelopeTenant } from '../tenancy/envelope-tenant';

interface AttachedConsumer {
  consumerGroup: string;
  server: Server;
  /** 다시 넣을 행이 든 DB 의 테넌트(② 에서만). 없으면 봉투를 그대로 보낸다 */
  redriveTenant: () => string | undefined;
}

/**
 * 다시 넣을 봉투의 테넌트를 그 행이 든 DB 의 테넌트로 맞춘다 (ticket 30). 다시 넣기는 메시지마다 새 CLS 맥락에서 돌아 봉투의
 * 테넌트가 곧 DB 를 고른다 — 맞추지 않으면 ① 시절의 테넌트 없는 행은 ② 문에서 다시 거절되고, 봉투가 다른 테넌트면 핸들러와
 * 결과 기록(`markRedriven`)이 남의 테넌트 DB 에 닿는다(같은 id 의 남의 행을 고친다). 계정 이벤트는 테넌트와 무관하게 통과하므로
 * 건드리지 않는다. 봉투를 못 알아보면 그대로 둔다.
 */
function withRowTenant(row: DeadLetterRow, tenantId: string | undefined): unknown {
  const envelope = asRecord(row.envelope);
  if (!tenantId || !envelope || typeof envelope.messageType !== 'string') return row.envelope;
  if (eventTenancy(row.topic, envelope.messageType) === 'account') return row.envelope;
  return stampEnvelopeTenant(envelope, tenantId);
}

/**
 * 컨슈머 그룹과 마이크로서비스 서버를 붙든다 (#1016 8번, 스펙 §7.2). `startConsumer` 가 `attach` 한다 —
 * 그래서 `groupId` 의 정본은 `startConsumer` 인자 하나로 남는다.
 *
 * 테이블이 없으면(마이그 전 배포) `startConsumer` 가 붙이지 않는다 — 그 앱은 옛 `.dlq` 경로로 돌고, 이 런타임을 쓰는
 * API 는 «시작되지 않았다» 오류를 낸다.
 */
@Injectable()
export class DeadLetterRuntime {
  private attached?: AttachedConsumer;

  attach(options: AttachedConsumer): void {
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
   * 봉투의 테넌트는 그 행이 든 DB 의 테넌트로 맞춰 보낸다(`withRowTenant`) — 행 자체는 바꾸지 않는다.
   */
  async dispatch(row: DeadLetterRow): Promise<boolean> {
    const { server, redriveTenant } = this.require();
    return dispatchToServerHandler(server, {
      topic: row.topic,
      partition: row.kafkaPartition,
      offset: row.kafkaOffset,
      key: row.sequenceKey ?? '',
      value: JSON.stringify(withRowTenant(row, redriveTenant())),
      headers: { [DEAD_LETTER_HEADERS.id]: String(row.id), [DEAD_LETTER_HEADERS.handler]: row.handler },
      timestamp: String(Date.now()),
    });
  }

  private require(): AttachedConsumer {
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
