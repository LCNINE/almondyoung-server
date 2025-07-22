// BNPL 이벤트 클래스들 - Event Sourcing Pattern
// BNPL 계정과 거래의 모든 중요한 생명주기 이벤트를 정의합니다.

/**
 * BNPL 계정 생성 이벤트
 */
export class BnplAccountCreatedEvent {
  constructor(
    public readonly bnplAccountId: string,
    public readonly userId: string,
    public readonly approvedLimit: number,
    public readonly createdAt: Date = new Date(),
  ) {}
}

/**
 * BNPL 신용 한도 사용 이벤트
 */
export class BnplCreditUsedEvent {
  constructor(
    public readonly bnplAccountId: string,
    public readonly userId: string,
    public readonly transactionId: string,
    public readonly amount: number,
    public readonly remainingCredit: number,
    public readonly usedAt: Date = new Date(),
  ) {}
}

/**
 * BNPL 신용 한도 복원 이벤트
 */
export class BnplCreditRestoredEvent {
  constructor(
    public readonly bnplAccountId: string,
    public readonly userId: string,
    public readonly transactionId: string,
    public readonly amount: number,
    public readonly newAvailableCredit: number,
    public readonly restoredAt: Date = new Date(),
  ) {}
}

/**
 * BNPL 신용 한도 변경 이벤트
 */
export class BnplCreditLimitChangedEvent {
  constructor(
    public readonly bnplAccountId: string,
    public readonly userId: string,
    public readonly oldLimit: number,
    public readonly newLimit: number,
    public readonly reason: string,
    public readonly changedBy: string,
    public readonly changedAt: Date = new Date(),
  ) {}
}

/**
 * BNPL 계정 상태 변경 이벤트
 */
export class BnplAccountStatusChangedEvent {
  constructor(
    public readonly bnplAccountId: string,
    public readonly userId: string,
    public readonly oldStatus: string,
    public readonly newStatus: string,
    public readonly reason: string,
    public readonly changedBy: string,
    public readonly changedAt: Date = new Date(),
  ) {}
}