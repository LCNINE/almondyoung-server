import { ConfirmService } from './confirm.service';

// ─── Test context ─────────────────────────────────────────────────────────────
//
// Scenario: a previous composite attempt (POINTS + Toss) left a SUCCEEDED POINTS
// hold and an abandoned Toss charge. The customer now retries WITHOUT applying
// points (external-only). The stale POINTS hold must still be released.

function makeIntent() {
  return {
    id: 'intent-1',
    status: 'REQUIRES_ACTION',
    userId: 'user-1',
    currency: 'KRW',
    payableAmount: 51170,
    metadata: {},
    version: 1,
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
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  };
}

function makeContext() {
  const intent = makeIntent();

  const stalePointsCharge = {
    id: 'charge-points',
    intentId: 'intent-1',
    paymentMethodId: 'pm-points',
    amount: 8130,
    currency: 'KRW',
    status: 'SUCCEEDED',
  };

  const pointsProvider = { cancel: jest.fn().mockResolvedValue(undefined) };
  const extProvider = {
    authorize: jest
      .fn()
      .mockResolvedValue({ status: 'REQUIRES_ACTION', nextAction: { type: 'TOSS_CHECKOUT' } }),
  };

  const chargesService = {
    findActiveByIntentAndOperation: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'charge-ext' }),
    findSucceededPointsAuthorizeByIntent: jest.fn().mockResolvedValue(stalePointsCharge),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-key'),
  };

  const paymentMethodsService = {
    findById: jest.fn().mockResolvedValue({ id: 'pm-toss', type: 'TOSS', providerData: {} }),
    findOrCreatePointsMethod: jest.fn().mockResolvedValue({ id: 'pm-points' }),
  };

  const providerRegistry = {
    getProviderOrThrow: jest
      .fn()
      .mockImplementation((type: string) => (type === 'POINTS' ? pointsProvider : extProvider)),
  };

  const autoCaptureService = { attemptAutoCapture: jest.fn().mockResolvedValue(undefined) };
  const stateTransitionService = { transitionIntent: jest.fn().mockResolvedValue(undefined) };

  const updateSet = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
  const dbService = {
    db: {
      transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(makeTx(intent))),
      update: jest.fn().mockReturnValue({ set: updateSet }),
    },
  };

  const service = new ConfirmService(
    dbService as never,
    paymentMethodsService as never,
    chargesService as never,
    providerRegistry as never,
    autoCaptureService as never,
    stateTransitionService as never,
  );

  return { service, pointsProvider, chargesService, updateSet };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConfirmService', () => {
  it('releases a stale SUCCEEDED POINTS hold on retry even when no points are applied', async () => {
    const { service, pointsProvider, chargesService } = makeContext();

    await service.confirm('intent-1', { paymentMethodId: 'pm-toss', pointsToApply: 0 }, 'corr-1');

    expect(pointsProvider.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ chargeId: 'charge-points', intentId: 'intent-1', amount: 8130 }),
    );
    expect(chargesService.updateStatus).toHaveBeenCalledWith('charge-points', 'CANCELED', {});
  });

  it('stamps a short action-expiry deadline when entering REQUIRES_ACTION', async () => {
    const { service, updateSet } = makeContext();

    await service.confirm('intent-1', { paymentMethodId: 'pm-toss', pointsToApply: 0 }, 'corr-1');

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ actionExpiresAt: expect.any(Date) }),
    );
  });
});
