// Payment 이벤트 클래스들 - Event Sourcing Pattern
// 결제의 모든 중요한 생명주기 이벤트를 정의합니다.

/**
 * 결제 승인 이벤트 (AUTHORIZED)
 */
export class PaymentAuthorizedEvent {
  constructor(
    public readonly paymentEventId: string,
    public readonly invoiceId: string,
    public readonly paymentMethodId: string,
    public readonly amount: number,
    public readonly userId: string,
    public readonly authorizedAt: Date,
  ) {}
}

/**
 * 결제 완료 이벤트 (CAPTURED)
 */
export class PaymentCapturedEvent {
  constructor(
    public readonly paymentEventId: string,
    public readonly invoiceId: string,
    public readonly amount: number,
    public readonly pgTransactionId: string,
    public readonly capturedAt: Date,
  ) {}
}

/**
 * 결제 실패 이벤트 (FAILED)
 */
export class PaymentFailedEvent {
  constructor(
    public readonly paymentEventId: string,
    public readonly invoiceId: string,
    public readonly amount: number,
    public readonly reason: string,
    public readonly failedAt: Date,
  ) {}
}

/**
 * 정산 배치 시작 이벤트
 */
export class SettlementBatchStartedEvent {
  constructor(
    public readonly batchId: string,
    public readonly bnplAccountId: string,
    public readonly totalAmount: number,
    public readonly transactionCount: number,
    public readonly startedAt: Date,
  ) {}
}

/**
 * 정산 배치 완료 이벤트
 */
export class SettlementBatchCompletedEvent {
  constructor(
    public readonly batchId: string,
    public readonly bnplAccountId: string,
    public readonly totalAmount: number,
    public readonly status: 'COMPLETED' | 'FAILED',
    public readonly completedAt: Date,
  ) {}
}
