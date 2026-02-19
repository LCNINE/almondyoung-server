import {
  buildPaymentIntentEventPayload,
  buildRefundEventPayload,
} from './payments-event.builder';

describe('payments-event.builder', () => {
  it('builds payment intent payload with required fields', () => {
    const payload = buildPaymentIntentEventPayload({
      intentId: 'intent-1',
      referenceType: 'STORE_ORDER',
      referenceId: 'order-1',
      customerId: 'customer-1',
      status: 'SUCCEEDED',
      payableAmount: 1000,
      currency: 'KRW',
    });

    expect(payload).toMatchObject({
      intentId: 'intent-1',
      referenceType: 'STORE_ORDER',
      referenceId: 'order-1',
      customerId: 'customer-1',
      status: 'SUCCEEDED',
      payableAmount: 1000,
      currency: 'KRW',
    });
    expect(typeof payload.occurredAt).toBe('string');
  });

  it('builds refund payload with allocation and extra fields', () => {
    const payload = buildRefundEventPayload({
      refundId: 'refund-1',
      intentId: 'intent-1',
      referenceType: 'STORE_ORDER',
      referenceId: 'order-1',
      customerId: 'customer-1',
      refundAmount: 1000,
      currency: 'KRW',
      allocation: [
        {
          legId: 'leg-1',
          amount: 1000,
        },
      ],
      extra: {
        reasonCode: 'REFUND_FAILED',
      },
    });

    expect(payload).toMatchObject({
      refundId: 'refund-1',
      intentId: 'intent-1',
      referenceType: 'STORE_ORDER',
      referenceId: 'order-1',
      customerId: 'customer-1',
      refundAmount: 1000,
      currency: 'KRW',
      reasonCode: 'REFUND_FAILED',
    });
    expect(payload.allocation).toEqual([
      {
        legId: 'leg-1',
        amount: 1000,
      },
    ]);
  });

  it('throws when mandatory refund fields are invalid', () => {
    expect(() =>
      buildRefundEventPayload({
        refundId: 'refund-1',
        intentId: 'intent-1',
        referenceType: 'STORE_ORDER',
        referenceId: 'order-1',
        customerId: 'customer-1',
        refundAmount: 1000,
        currency: 'KRW',
        allocation: [],
      }),
    ).toThrow(/PAYMENTS_EVENT_PAYLOAD_INVALID/);
  });
});

