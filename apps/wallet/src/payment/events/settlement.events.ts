// Settlement 이벤트 클래스들 - Event Sourcing Pattern
// 정산 배치의 모든 중요한 생명주기 이벤트를 정의합니다.

/**
 * 정산 배치 생성 이벤트
 */
export class SettlementBatchCreatedEvent {
  constructor(
    public readonly batchId: string,
    public readonly bnplAccountId: string,
    public readonly batchNumber: string,
    public readonly totalAmount: number,
    public readonly transactionCount: number,
    public readonly dueDate: Date,
    public readonly createdAt: Date = new Date(),
  ) {}
}

/**
 * 정산 배치 시작 이벤트 (PG사 요청 시작)
 */
export class SettlementBatchStartedEvent {
  constructor(
    public readonly batchId: string,
    public readonly bnplAccountId: string,
    public readonly totalAmount: number,
    public readonly transactionCount: number,
    public readonly startedAt: Date = new Date(),
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
    public readonly completedAt: Date = new Date(),
  ) {}
}

/**
 * 정산 배치 실패 이벤트
 */
export class SettlementBatchFailedEvent {
  constructor(
    public readonly batchId: string,
    public readonly bnplAccountId: string,
    public readonly totalAmount: number,
    public readonly reason: string,
    public readonly failedAt: Date = new Date(),
  ) {}
}

/**
 * 정산 배치 아이템 추가 이벤트
 */
export class SettlementBatchItemAddedEvent {
  constructor(
    public readonly batchId: string,
    public readonly bnplTransactionId: string,
    public readonly amount: number,
    public readonly addedAt: Date = new Date(),
  ) {}
}

/**
 * 정산 배치 상태 변경 이벤트
 */
export class SettlementBatchStatusChangedEvent {
  constructor(
    public readonly batchId: string,
    public readonly oldStatus: string,
    public readonly newStatus: string,
    public readonly reason: string,
    public readonly changedAt: Date = new Date(),
  ) {}
}