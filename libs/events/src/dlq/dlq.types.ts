/**
 * DLQ (Dead Letter Queue) Types
 */

import { MessageEnvelope } from '@packages/event-contracts/types';

/** `.dlq` 로 보낸 실패가 누구의 것인가 — 토픽이 구독자끼리 섞이므로 가져오기(`untenanted-dlq-import`)가 이걸로 고른다 */
export interface DlqOrigin {
  /** 실패 테이블을 켠 앱만 안다 */
  consumerGroup?: string;
  /** `클래스.메서드` — 실패 행의 `handler` 칸·다시 넣기 헤더와 같은 값 */
  handler: string;
}

/** 봉투로 알아볼 수 없는 메시지의 원본 */
export interface UnrecognizedMessage {
  raw: string;
}

/**
 * DLQ에 저장되는 메시지 구조
 */
export interface DLQMessage<TPayload = unknown> {
  // DLQ 식별 정보
  dlqMessageId: string; // DLQ 메시지 고유 ID
  dlqTopic: string; // DLQ 토픽 이름

  // 원본 메시지 정보
  originalTopic: string;
  originalPartition: number;
  originalOffset: string;
  /** 알아볼 수 없는 메시지(깨진 JSON·`messageType` 없음)는 원본 글자를 `raw` 로 */
  originalMessage: MessageEnvelope<TPayload> | UnrecognizedMessage;

  // 에러 정보
  error: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };

  // 처리 컨텍스트
  context: Partial<DlqOrigin> & {
    consumer: string; // Consumer 이름
    retryCount: number; // 재시도 횟수
    attemptHistory: Array<{
      attemptedAt: string;
      error: string;
    }>;
  };

  // 타임스탬프
  failedAt: string; // ISO 8601

  // 재처리 상태
  status: 'pending' | 'reprocessing' | 'reprocessed' | 'resolved';
  reprocessAttempts: number;
  lastReprocessAt?: string;
  reprocessedAt?: string;
  resolvedAt?: string;
  resolvedReason?: string;
}

/**
 * DLQ 통계
 */
export interface DLQStats {
  [dlqTopic: string]: {
    pending: number;
    reprocessing: number;
    reprocessed: number;
    resolved: number;
    total: number;
  };
}
