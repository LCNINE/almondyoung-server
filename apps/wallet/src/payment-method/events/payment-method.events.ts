import { BaseEvent } from '../../shared/events/base.event';

/**
 * 결제수단 생성 이벤트
 * 새로운 결제수단이 생성되었을 때 발행됩니다.
 */
export class PaymentMethodCreatedEvent extends BaseEvent {
  constructor(
    public readonly paymentMethodId: string,
    public readonly userId: string,
    public readonly methodType: 'CARD' | 'BANK_ACCOUNT' | 'BNPL' | 'REWARD_POINT',
    public readonly methodName: string,
    public readonly institutionCode: string,
    public readonly isDefault: boolean,
    baseData: {
      correlationId?: string;
      actor: 'USER' | 'SYSTEM' | 'SCHEDULER' | 'ADMIN';
    }
  ) {
    super(baseData);
  }

  protected getEventData(): Record<string, any> {
    return {
      paymentMethodId: this.paymentMethodId,
      userId: this.userId,
      methodType: this.methodType,
      methodName: this.methodName,
      institutionCode: this.institutionCode,
      isDefault: this.isDefault,
    };
  }
}

/**
 * 결제수단 활성화 이벤트
 * 결제수단이 활성화되었을 때 발행됩니다.
 */
export class PaymentMethodActivatedEvent extends BaseEvent {
  constructor(
    public readonly paymentMethodId: string,
    public readonly userId: string,
    public readonly methodType: 'CARD' | 'BANK_ACCOUNT' | 'BNPL' | 'REWARD_POINT',
    baseData: {
      correlationId?: string;
      actor: 'USER' | 'SYSTEM' | 'SCHEDULER' | 'ADMIN';
    }
  ) {
    super(baseData);
  }

  protected getEventData(): Record<string, any> {
    return {
      paymentMethodId: this.paymentMethodId,
      userId: this.userId,
      methodType: this.methodType,
    };
  }
}

/**
 * BatchCMS 결제수단 등록 이벤트
 * BNPL용 BatchCMS 결제수단이 등록되었을 때 발행됩니다.
 * 이 이벤트를 받은 BNPL 도메인에서 bnplAccount를 생성합니다.
 */
export class BatchCmsMethodRegisteredEvent extends BaseEvent {
  constructor(
    public readonly paymentMethodId: string,
    public readonly userId: string,
    public readonly hmsMemberId: string,
    public readonly hmsCustId: string,
    public readonly creditLimit: number,
    public readonly approvedLimit: number,
    public readonly billingCycleDay: number,
    public readonly termsUrl?: string,
    baseData: {
      correlationId?: string;
      actor: 'USER' | 'SYSTEM' | 'SCHEDULER' | 'ADMIN';
    }
  ) {
    super(baseData);
  }

  protected getEventData(): Record<string, any> {
    return {
      paymentMethodId: this.paymentMethodId,
      userId: this.userId,
      hmsMemberId: this.hmsMemberId,
      hmsCustId: this.hmsCustId,
      creditLimit: this.creditLimit,
      approvedLimit: this.approvedLimit,
      billingCycleDay: this.billingCycleDay,
      termsUrl: this.termsUrl,
    };
  }
}

/**
 * 결제수단 비활성화 이벤트
 * 결제수단이 비활성화되었을 때 발행됩니다.
 */
export class PaymentMethodDeactivatedEvent extends BaseEvent {
  constructor(
    public readonly paymentMethodId: string,
    public readonly userId: string,
    public readonly methodType: 'CARD' | 'BANK_ACCOUNT' | 'BNPL' | 'REWARD_POINT',
    public readonly reason?: string,
    baseData: {
      correlationId?: string;
      actor: 'USER' | 'SYSTEM' | 'SCHEDULER' | 'ADMIN';
    }
  ) {
    super(baseData);
  }

  protected getEventData(): Record<string, any> {
    return {
      paymentMethodId: this.paymentMethodId,
      userId: this.userId,
      methodType: this.methodType,
      reason: this.reason,
    };
  }
}