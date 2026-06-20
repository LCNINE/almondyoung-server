import { AbandonService } from './abandon.service';

// ─── Test context ─────────────────────────────────────────────────────────────
//
// Abandon = soft reset of an in-flight checkout action. It must release any
// provider-side holds (points hold, in-flight Toss charge) and return the intent
// to CREATED so Medusa can reuse the same intent (getPaymentStatus reads CREATED
// as `pending`). It must NOT run once a webhook/redirect has already finalised
// the intent (AUTHORIZED/CAPTURED).

function makeIntent(status: string) {
  return {
    id: 'intent-1',
    status,
    userId: 'user-1',
    currency: 'KRW',
    payableAmount: 51170,
  };
}

function makeTx(intent: ReturnType<typeof makeIntent>) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({
            limit: () => [intent],
          }),
        }),
      }),
    }),
  };
}

function makeContext(status: string) {
  const intent = makeIntent(status);

  const chargeReleaseService = {
    releaseIntentCharges: jest.fn().mockResolvedValue(undefined),
  };
  const stateTransitionService = {
    transitionIntent: jest.fn().mockResolvedValue(undefined),
  };
  const dbService = {
    db: { transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(makeTx(intent))) },
  };

  const service = new AbandonService(
    dbService as never,
    chargeReleaseService as never,
    stateTransitionService as never,
  );

  return { service, chargeReleaseService, stateTransitionService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AbandonService', () => {
  it('releases charges and resets a REQUIRES_ACTION intent to CREATED', async () => {
    const { service, chargeReleaseService, stateTransitionService } = makeContext('REQUIRES_ACTION');

    const result = await service.abandon('intent-1', 'corr-1');

    expect(chargeReleaseService.releaseIntentCharges).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'intent-1' }),
      'corr-1',
    );
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'CREATED',
      expect.objectContaining({ reasonCode: 'CHECKOUT_ABANDONED' }),
      undefined,
      expect.anything(),
    );
    expect(result.status).toBe('CREATED');
  });

  it('is a no-op when the intent is already AUTHORIZED (webhook won the race)', async () => {
    const { service, chargeReleaseService, stateTransitionService } = makeContext('AUTHORIZED');

    const result = await service.abandon('intent-1', 'corr-1');

    expect(chargeReleaseService.releaseIntentCharges).not.toHaveBeenCalled();
    expect(stateTransitionService.transitionIntent).not.toHaveBeenCalled();
    expect(result.status).toBe('AUTHORIZED');
  });
});
