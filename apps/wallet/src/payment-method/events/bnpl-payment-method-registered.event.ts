export class BnplPaymentMethodRegisteredEvent {
  constructor(
    public readonly paymentMethodId: string,
    public readonly userId: string,
    public readonly creditLimit: number,
    public readonly approvedLimit: number,
    public readonly billingCycleDay: number,
  ) {}
}
