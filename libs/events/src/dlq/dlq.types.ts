/**
 * DLQ (Dead Letter Queue) Types
 */

import { MessageEnvelope } from '../envelope.types';

/**
 * DLQ에 저장되는 메시지 구조
 */
export interface DLQMessage<TPayload = unknown> {
  // DLQ 식별 정보
  dlqMessageId: string;                // DLQ 메시지 고유 ID
  dlqTopic: string;                    // DLQ 토픽 이름

  // 원본 메시지 정보
  originalTopic: string;
  originalPartition: number;
  originalOffset: string;
  originalMessage: MessageEnvelope<TPayload>;

  // 에러 정보
  error: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };

  // 처리 컨텍스트
  context: {
    consumer: string;                  // Consumer 이름
    retryCount: number;                // 재시도 횟수
    attemptHistory: Array<{
      attemptedAt: string;
      error: string;
    }>;
  };

  // 타임스탬프
  failedAt: string;                    // ISO 8601

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

/**
 * 재처리 옵션
 */
export interface ReprocessOptions {
  skipValidation?: boolean;
  targetPartition?: number;
  delayMs?: number;
}

/**
 * 일괄 재처리 결과
 */
export interface BatchReprocessResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{
    dlqMessageId: string;
    error: string;
  }>;
}
