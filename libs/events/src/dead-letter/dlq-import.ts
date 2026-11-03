import type { TenantList } from '@app/tenancy';
import type { dead_letters } from './dead-letter.schema';
import { asRecord, stampEnvelopeTenant } from '../tenancy/envelope-tenant';

export type DeadLetterImportRow = typeof dead_letters.$inferInsert;

/** 가져오지 않는 이유. `other-consumer` 는 공용 토픽의 남의 몫이라 목록에도 보이지 않는다 */
export type DlqSkipCode = 'not-dlq' | 'other-consumer' | 'unrecognized' | 'other-tenant';

export type DlqImportVerdict =
  | { kind: 'import'; row: DeadLetterImportRow }
  | { kind: 'skip'; code: DlqSkipCode; reason: string };

export interface DlqImportTarget {
  /** 실패 테이블을 켠 앱의 컨슈머 그룹(`startConsumer` 의 `groupId`) — 공용 `.dlq` 토픽에서 이 앱의 것만 고른다 */
  consumerGroup: string;
  /** 사람이 지목한 테넌트. 그 테넌트의 실패 테이블에 넣는다 */
  tenantId: string;
  tenants: TenantList;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * `.dlq` 토픽의 메시지 하나(`DLQHandler.sendToDLQ` 가 쓴 모양)를 지목한 테넌트의 실패 행으로 바꾼다 (ticket 30).
 *
 * ② 에서 테넌트 맥락 없는 실패는 어느 테넌트 DB 에도 못 둬서 `.dlq` 로 간다(`EventRetryInterceptor`). 사람이 테넌트를 정해
 * 봉투에 붙이고 그 테넌트의 `event.dead_letters` 에 `failed` 로 넣으면, 그 뒤는 기존 다시 넣기다 — 봉투에 테넌트가 있으니
 * ② 문을 통과하고 그 테넌트 DB 에 쓴다. Kafka 를 거치지 않으므로 다른 구독자는 아무것도 다시 받지 않는다.
 *
 * 순서 키는 비운다(혼자 한 순서). 이 메시지가 `.dlq` 에 있는 동안 같은 주문의 뒤 메시지는 이미 처리됐다 — 키를 달면 넣는 순간
 * 그 주문의 새 메시지가 이 행 뒤에 보류되는데, 지킬 순서는 이미 깨져 있다.
 *
 * 가져오지 않는 것(skip): 다른 컨슈머 그룹·그룹이 없는 옛 메시지(공용 토픽이라 섞인다), 봉투를 못 알아보는 메시지(다시 넣어도
 * 검증에서 실패한다), 목록에 있는 다른 테넌트의 봉투(사람이 테넌트를 잘못 골랐다). 지목한 테넌트가 목록에 없으면 던진다 — 넣을 DB 가 없다.
 */
export function deadLetterFromDlq(message: unknown, target: DlqImportTarget): DlqImportVerdict {
  if (!target.tenants.find(target.tenantId)) {
    throw new Error(`테넌트 «${target.tenantId}» 가 테넌트 목록에 없다`);
  }

  const dlq = asRecord(message);
  const context = asRecord(dlq?.context);
  const error = asRecord(dlq?.error);
  const topic = text(dlq?.originalTopic);
  const partition = dlq?.originalPartition;
  const offset = text(dlq?.originalOffset);
  if (!dlq || !context || !topic || typeof partition !== 'number' || !offset) {
    return { kind: 'skip', code: 'not-dlq', reason: 'DLQ 메시지 모양이 아니다' };
  }

  const group = text(context.consumerGroup);
  const handler = text(context.handler);
  if (group !== target.consumerGroup || !handler) {
    return {
      kind: 'skip',
      code: 'other-consumer',
      reason: `이 앱(${target.consumerGroup})의 실패가 아니다 — 그룹 ${group ?? '없음'}`,
    };
  }

  const envelope = asRecord(dlq.originalMessage);
  const messageType = text(envelope?.messageType);
  if (!envelope || !messageType) {
    return { kind: 'skip', code: 'unrecognized', reason: '봉투를 못 알아본다 — 다시 넣어도 검증에서 실패한다' };
  }

  const metadata = asRecord(envelope.metadata) ?? {};
  const current = text(metadata.tenantId);
  if (current && current !== target.tenantId && target.tenants.find(current)) {
    return { kind: 'skip', code: 'other-tenant', reason: `봉투가 이미 목록의 테넌트 «${current}» 다` };
  }

  return {
    kind: 'import',
    row: {
      consumerGroup: group,
      handler,
      topic,
      sequenceKey: null,
      messageId: text(envelope.messageId) ?? `${topic}:${partition}:${offset}`,
      eventType: messageType,
      envelope: stampEnvelopeTenant(envelope, target.tenantId),
      kafkaPartition: partition,
      kafkaOffset: offset,
      status: 'failed',
      errorName: text(error?.name) ?? null,
      errorMessage: text(error?.message) ?? null,
    },
  };
}
