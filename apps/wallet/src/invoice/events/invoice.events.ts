// Invoice 이벤트 클래스들 - Event Sourcing Pattern
// 청구서의 모든 중요한 생명주기 이벤트를 정의합니다.

/**
 * 청구서 생성 이벤트
 */
export class InvoiceIssuedEvent {
  constructor(
    public readonly invoiceId: string,
    public readonly userId: string,
    public readonly amount: number,
    public readonly invoiceType: string,
    public readonly issuedAt: Date,
  ) {}
}

/**
 * 청구서 결제 완료 이벤트 (CAPTURED)
 */
export class InvoicePaidEvent {
  constructor(
    public readonly invoiceId: string,
    public readonly paymentEventId: string,
    public readonly amount: number,
    public readonly paidAt: Date,
  ) {}
}

/**
 * 청구서 결제 실패 이벤트 (FAILED)
 */
export class InvoiceFailedEvent {
  constructor(
    public readonly invoiceId: string,
    public readonly paymentEventId: string,
    public readonly reason: string,
    public readonly failedAt: Date,
  ) {}
}

/**
 * 청구서 부분 환불 이벤트
 */
export class InvoicePartiallyRefundedEvent {
  constructor(
    public readonly invoiceId: string,
    public readonly refundEventId: string,
    public readonly refundAmount: number,
    public readonly remainingAmount: number,
    public readonly refundedAt: Date,
  ) {}
}

/**
 * 청구서 전액 환불 이벤트
 */
export class InvoiceFullyRefundedEvent {
  constructor(
    public readonly invoiceId: string,
    public readonly refundEventId: string,
    public readonly refundAmount: number,
    public readonly refundedAt: Date,
  ) {}
}

/**
 * 청구서 취소 이벤트
 */
export class InvoiceCancelledEvent {
  constructor(
    public readonly invoiceId: string,
    public readonly reason: string,
    public readonly cancelledBy: string,
    public readonly cancelledAt: Date,
  ) {}
}

/**
 * 청구서 연체 처리 이벤트
 */
export class InvoiceMarkedAsOverdueEvent {
  constructor(
    public readonly invoiceId: string,
    public readonly dueDate: Date,
    public readonly markedAt: Date,
  ) {}
}