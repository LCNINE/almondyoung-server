// Refund 이벤트 클래스들 - Event Sourcing Pattern
// 환불의 모든 중요한 생명주기 이벤트를 정의합니다.

/**
 * 환불 요청 이벤트 (REQUESTED)
 */
export class RefundRequestedEvent {
  constructor(
    public readonly refundId: string,
    public readonly data: {
      paymentEventId: string;
      refundAccountId: string;
      amount: number;
      reason: string;
    },
  ) {}
}

/**
 * 환불 처리 시작 이벤트 (PROCESSING)
 */
export class RefundProcessingEvent {
  constructor(
    public readonly refundId: string,
    public readonly processedBy: string,
    public readonly notes?: string,
    public readonly processedAt: Date = new Date(),
  ) {}
}

/**
 * 환불 완료 이벤트 (COMPLETED)
 */
export class RefundCompletedEvent {
  constructor(
    public readonly refundId: string,
    public readonly data: any,
    public readonly completedAt: Date = new Date(),
  ) {}
}

/**
 * 환불 거절 이벤트 (REJECTED)
 */
export class RefundRejectedEvent {
  constructor(
    public readonly refundId: string,
    public readonly rejectedBy: string,
    public readonly reason: string,
    public readonly notes?: string,
    public readonly rejectedAt: Date = new Date(),
  ) {}
}