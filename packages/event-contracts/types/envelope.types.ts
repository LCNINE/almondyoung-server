/**
 * Message Envelope Types
 *
 * 모든 이벤트/커맨드 메시지를 감싸는 표준 Envelope 구조
 */

/**
 * 모든 메시지를 감싸는 표준 Envelope
 */
export interface MessageEnvelope<TPayload = unknown> {
  // === 식별 정보 ===
  messageId: string;                   // ULID (시간순 정렬 가능)
  messageType: string;                 // 'OrderCreated', 'StockAdjusted', etc.
  messageVersion: number;              // 메시지 스키마 버전
  messageKind: 'event' | 'command';    // 이벤트 vs 명령 구분

  // === 추적 정보 ===
  correlationId: string;               // 요청 추적용 (전체 플로우)
  causationId?: string;                // 이 메시지를 발생시킨 메시지 ID

  // === 시간 정보 ===
  timestamp: string;                   // ISO 8601 (메시지 생성 시각)
  occurredAt?: string;                 // 실제 이벤트 발생 시각 (다를 수 있음)

  // === 출처 정보 ===
  source: {
    service: string;                   // 'wms-order', 'user-service'
    aggregateType: string;             // 'Order', 'User', 'Stock'
    aggregateId: string;               // 'ORD-123', 'USR-456'
    aggregateVersion?: number;         // Event Sourcing용 버전
  };

  // === 실제 데이터 ===
  payload: TPayload;

  // === 메타데이터 (선택) ===
  metadata?: {
    userId?: string;
    tenantId?: string;
    traceId?: string;
    tags?: string[];
    [key: string]: unknown;
  };
}

/**
 * 도메인 이벤트 (과거 사실)
 *
 * 이미 발생한 사실을 전파하는 메시지
 *
 * @example
 * const event: DomainEvent<OrderCreatedPayload> = {
 *   messageKind: 'event',
 *   messageType: 'OrderCreated',
 *   payload: { orderId: 'ORD-123', ... }
 * }
 */
export type DomainEvent<TPayload = unknown> = MessageEnvelope<TPayload> & {
  messageKind: 'event';
};

/**
 * 도메인 명령 (미래 요청)
 *
 * 어떤 액션을 수행하라는 요청 메시지
 *
 * @example
 * const command: DomainCommand<ProcessOrderPayload> = {
 *   messageKind: 'command',
 *   messageType: 'ProcessOrder',
 *   expiresAt: '2025-01-01T00:00:00Z',
 *   payload: { orderId: 'ORD-123' }
 * }
 */
export type DomainCommand<TPayload = unknown> = MessageEnvelope<TPayload> & {
  messageKind: 'command';
  expiresAt?: string;                  // 명령 유효기간
};

/**
 * Type guard: DomainEvent인지 확인
 */
export function isDomainEvent(message: MessageEnvelope): message is DomainEvent {
  return message.messageKind === 'event';
}

/**
 * Type guard: DomainCommand인지 확인
 */
export function isDomainCommand(message: MessageEnvelope): message is DomainCommand {
  return message.messageKind === 'command';
}
