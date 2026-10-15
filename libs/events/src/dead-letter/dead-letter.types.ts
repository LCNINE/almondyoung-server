/**
 * 컨슈머 실패 기록 (#1016 8번, 스펙 §5·§6). 상태는 varchar + 이 유니온 — pgEnum 은 값을 더할 때마다 마이그가 필요하다.
 *
 * - `failed`: 처리하다 실패했다(순서의 머리)
 * - `held`: 앞 실패 때문에 처리하지 않고 보관했다
 * - `redriven`: 다시 넣어서 성공했다
 * - `discarded`: 사람이 종결했다
 */
export type DeadLetterStatus = 'failed' | 'held' | 'redriven' | 'discarded';
export const UNRESOLVED_DEAD_LETTER_STATUSES = ['failed', 'held'] as const;

/** 다시 넣기로 들어온 메시지의 표시 (스펙 §6.4). 이 헤더가 있으면 보류 검사를 건너뛰고 한 번만 시도한다. */
export const DEAD_LETTER_HEADERS = {
  id: 'x-dead-letter-id',
  handler: 'x-dead-letter-handler',
} as const;

export type FailureActionKind = 'dead_letter' | 'outbox';
export type FailureAction = 'redrive' | 'discard';
export type FailureActionOutcome = 'succeeded' | 'failed';

/** 인터셉터가 한 메시지에 대해 아는 것. 저장은 이 모양 그대로다. */
export interface DeadLetterMessage {
  consumerGroup: string;
  /** `클래스.메서드` — 같은 이벤트를 받는 핸들러가 둘 이상일 때 대상을 가른다 */
  handler: string;
  topic: string;
  /**
   * `envelope.source.aggregateId`. 없으면 null — 그 행은 혼자 한 순서다. 순서를 지키지 않는 토픽(`sequencedTopics` 밖)의
   * 행도 혼자 한 순서다 — 이 칸은 표시용으로만 남는다
   */
  sequenceKey: string | null;
  messageId: string;
  eventType: string | null;
  envelope: unknown;
  kafkaPartition: number;
  kafkaOffset: string;
}

/**
 * 인터셉터가 쓰는 쓰기 port. 테스트는 메모리 구현을 넣는다 — 진짜 구현(`DeadLetterStore`)의 SQL 은 통합 스펙이 본다.
 * 모든 메서드는 실패하면 던진다. 인터셉터가 그것을 `DlqDeliveryError` 로 바꿔 오프셋을 커밋하지 않게 한다.
 */
export interface DeadLetterRecorder {
  /** 같은 순서에 안 푼 행이 있으면 이 메시지를 `held` 로 적고 true. 없으면 아무것도 안 적고 false */
  holdIfBlocked(message: DeadLetterMessage): Promise<boolean>;
  /** 최종 실패를 `failed` 로 적는다. 같은 유일 키가 있으면 그 행을 갱신한다 */
  recordFailure(message: DeadLetterMessage, error: Error): Promise<void>;
  /** 다시 넣기 성공 */
  markRedriven(id: number): Promise<void>;
  /** 다시 넣기 실패 — 그 행을 `failed` 로(머리가 된다) */
  recordRedriveFailure(id: number, error: Error): Promise<void>;
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
  status: string;
  errorName: string | null;
  errorMessage: string | null;
  redriveCount: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
  resolvedAt: Date | null;
}
