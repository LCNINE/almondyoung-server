import { buildOutboxInsertValues } from './outbox-event.util';

describe('outbox-event.util', () => {
  it('builds insert values with required defaults', () => {
    const values = buildOutboxInsertValues({
      eventType: 'PaymentIntentSucceeded',
      aggregateType: 'PaymentIntent',
      aggregateId: 'intent-1',
      payload: {
        intentId: 'intent-1',
      },
    });

    expect(values.messageId).toBeTruthy();
    expect(values.partitionKey).toBe('intent-1');
    expect(values.status).toBe('PENDING');
    expect(values.attempts).toBe(0);
    expect(values.createdAt).toBeInstanceOf(Date);
  });

  it('throws when required outbox fields are missing', () => {
    expect(() =>
      buildOutboxInsertValues({
        eventType: '',
        aggregateType: 'PaymentIntent',
        aggregateId: 'intent-1',
        payload: {
          intentId: 'intent-1',
        },
      }),
    ).toThrow(/OUTBOX_EVENT_FIELD_INVALID/);
  });

  it('throws when payload is not a plain object', () => {
    expect(() =>
      buildOutboxInsertValues({
        eventType: 'PaymentIntentSucceeded',
        aggregateType: 'PaymentIntent',
        aggregateId: 'intent-1',
        payload: [] as unknown as Record<string, unknown>,
      }),
    ).toThrow(/OUTBOX_PAYLOAD_INVALID/);
  });
});

