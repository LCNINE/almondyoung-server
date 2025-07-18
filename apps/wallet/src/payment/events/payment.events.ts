// 결제/정산 이벤트 클래스 정의

export class PaymentAuthorizedEvent {
  constructor(
    public readonly paymentId: string,
    public readonly data: any,
  ) {}
}

export class PaymentCapturedEvent {
  constructor(
    public readonly paymentId: string,
    public readonly data: any,
  ) {}
}

export class PaymentFailedEvent {
  constructor(
    public readonly paymentId: string,
    public readonly reason: string,
  ) {}
}

export class SettlementBatchStartedEvent {
  constructor(public readonly batchId: string) {}
}

export class SettlementBatchCompletedEvent {
  constructor(public readonly batchId: string) {}
}
