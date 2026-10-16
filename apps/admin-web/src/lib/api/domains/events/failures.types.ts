// 이벤트 실패 출구 응답 타입 (#1016 7·8번). 서버 정본은 PR 1 의 서비스들이다:
//   libs/events/src/dead-letter/dead-letter.query.ts   — summary·dead-letters 목록·상세
//   libs/events/src/dead-letter/dead-letter.redriver.ts — redrive·discard·redrive-all 결과
//   libs/events/src/outbox/outbox-failures.service.ts   — outbox 목록·상세·resend·discard·resend-all
// 서버의 Date 는 JSON 으로 오면서 ISO 문자열이 된다. 두 앱 모두 응답을 envelope 로 감싸지 않는다.

export type EventFailureService = 'core' | 'channel-adapter';
export const EVENT_FAILURE_SERVICES: readonly EventFailureService[] = ['core', 'channel-adapter'];

export interface EventFailuresSummary {
  deadLetters: { failed: number; held: number; oldestFailedAt: string | null };
  outbox: { failed: number; oldestFailedAt: string | null };
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: number | null;
}

/** 순서 하나 = 머리 행 + 뒤에서 기다리는 같은 순서의 안 푼 행 수 */
export interface DeadLetterSequenceItem {
  id: number;
  topic: string;
  handler: string;
  eventType: string | null;
  sequenceKey: string | null;
  status: string;
  errorName: string | null;
  errorMessage: string | null;
  firstFailedAt: string;
  redriveCount: number;
  heldBehind: number;
}

export interface DeadLetterRow {
  id: number;
  consumerGroup: string;
  handler: string;
  topic: string;
  sequenceKey: string | null;
  messageId: string;
  eventType: string | null;
  envelope: unknown;
  kafkaPartition: number;
  kafkaOffset: string;
  /** failed · held · redriven · discarded */
  status: string;
  errorName: string | null;
  errorMessage: string | null;
  redriveCount: number;
  firstFailedAt: string;
  lastFailedAt: string;
  resolvedAt: string | null;
}

export interface FailureActionRow {
  id: number;
  /** dead_letter · outbox */
  targetKind: string;
  targetId: number;
  /** redrive · discard */
  action: string;
  /** succeeded · failed */
  outcome: string;
  actor: string | null;
  note: string | null;
  createdAt: string;
}

export interface DeadLetterDetail {
  row: DeadLetterRow;
  /** 같은 순서의 행 전부(해결된 것 포함), id 순서 */
  sequence: DeadLetterRow[];
  actions: FailureActionRow[];
}

export interface RedriveStop {
  id: number;
  errorName: string | null;
  errorMessage: string | null;
}

/** 다시 넣기·종결 결과. 머리를 종결하면 뒤 보류가 이어서 다시 넣어진 결과다 */
export interface RedriveResult {
  processed: number;
  stoppedAt: RedriveStop | null;
}

export interface RedriveAllResult {
  sequences: number;
  succeeded: number;
  stopped: number;
  /** 다른 사람이 다시 넣는 중이라 건너뛴 순서 */
  busy: number;
  stoppedByError: Record<string, number>;
}

export interface OutboxFailedItem {
  id: number;
  topic: string;
  eventType: string;
  aggregateId: string;
  createdAt: string;
  failedAt: string | null;
  retryCount: number;
  errorMessage: string | null;
  /** 같은 (topic, aggregate_id) 뒤에서 기다리는 PENDING 수 */
  waitingBehind: number;
}

export interface OutboxFailureDetail extends OutboxFailedItem {
  status: string;
  payload: unknown;
  actions: FailureActionRow[];
}

export type ResendResult = { status: 'PUBLISHED' } | { status: 'FAILED'; error: string };

export interface ResendAllResult {
  total: number;
  published: number;
  failed: Array<{ id: number; error: string }>;
}
