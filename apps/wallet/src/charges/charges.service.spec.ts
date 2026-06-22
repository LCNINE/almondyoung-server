import { ChargesService } from './charges.service';

const INTENT_ID = '11111111-1111-4111-8111-111111111111';
const PM_ID = '22222222-2222-4222-8222-222222222222';

function makeCharge(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    intentId: INTENT_ID,
    paymentMethodId: PM_ID,
    amount: 10000,
    currency: 'KRW',
    operation: 'CAPTURE',
    status: 'SUCCEEDED',
    providerTransactionId: 'pay_123',
    providerIdempotencyKey: 'idem_123',
    errorCode: null,
    errorMessage: null,
    requestPayload: null,
    responsePayload: null,
    createdAt: new Date('2026-06-19T00:00:00Z'),
    updatedAt: new Date('2026-06-19T00:00:00Z'),
    ...overrides,
  };
}

function makeService(selectResults: unknown[][]) {
  const pending = [...selectResults];
  const db = {
    db: {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({
          where: () => ({
            orderBy: jest.fn().mockResolvedValue(pending.shift() ?? []),
          }),
        }),
      })),
    },
  };

  return { service: new ChargesService(db as any), db };
}

describe('ChargesService.findRefundableByIntent', () => {
  it('returns SUCCEEDED capture charges when capture rows exist', async () => {
    const captureSucceeded = makeCharge({ id: 'capture-ok', operation: 'CAPTURE', status: 'SUCCEEDED' });
    const captureRefunded = makeCharge({ id: 'capture-refunded', operation: 'CAPTURE', status: 'REFUNDED' });
    const { service, db } = makeService([[captureRefunded, captureSucceeded]]);

    await expect(service.findRefundableByIntent(INTENT_ID)).resolves.toEqual([captureSucceeded]);
    expect(db.db.select).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to AUTHORIZE when capture rows are already refunded', async () => {
    const captureRefunded = makeCharge({ id: 'capture-refunded', operation: 'CAPTURE', status: 'REFUNDED' });
    const authorizeSucceeded = makeCharge({ id: 'authorize-ok', operation: 'AUTHORIZE', status: 'SUCCEEDED' });
    const { service, db } = makeService([[captureRefunded], [authorizeSucceeded]]);

    await expect(service.findRefundableByIntent(INTENT_ID)).resolves.toEqual([]);
    expect(db.db.select).toHaveBeenCalledTimes(1);
  });

  it('falls back to AUTHORIZE only when no capture rows exist', async () => {
    const authorizeSucceeded = makeCharge({ id: 'authorize-ok', operation: 'AUTHORIZE', status: 'SUCCEEDED' });
    const { service, db } = makeService([[], [authorizeSucceeded]]);

    await expect(service.findRefundableByIntent(INTENT_ID)).resolves.toEqual([authorizeSucceeded]);
    expect(db.db.select).toHaveBeenCalledTimes(2);
  });
});
