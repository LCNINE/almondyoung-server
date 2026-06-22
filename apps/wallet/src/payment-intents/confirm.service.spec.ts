import { ConfirmService } from './confirm.service';

// ─── Test context ─────────────────────────────────────────────────────────────
//
// Scenario: a previous composite attempt (POINTS + Toss) left a SUCCEEDED POINTS
// hold and an abandoned Toss charge. The customer now retries WITHOUT applying
// points (external-only). The stale POINTS hold must still be released.

function makeIntent(overrides: Partial<{ status: string; payableAmount: number }> = {}) {
  return {
    id: 'intent-1',
    status: overrides.status ?? 'REQUIRES_ACTION',
    userId: 'user-1',
    currency: 'KRW',
    payableAmount: overrides.payableAmount ?? 51170,
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

function makeContext(
  opts: {
    providerActionMode?: 'interactive' | 'offline-wait';
    authorizeResult?: { status: string; nextAction?: Record<string, unknown> };
    methodType?: string;
    intent?: Partial<{ status: string; payableAmount: number }>;
    stalePointsCharge?: {
      id: string;
      intentId: string;
      paymentMethodId: string;
      amount: number;
      currency: string;
      status: string;
    } | null;
  } = {},
) {
  const intent = makeIntent(opts.intent);

  const stalePointsCharge =
    opts.stalePointsCharge === undefined
      ? {
          id: 'charge-points',
          intentId: 'intent-1',
          paymentMethodId: 'pm-points',
          amount: 8130,
          currency: 'KRW',
          status: 'SUCCEEDED',
        }
      : opts.stalePointsCharge;

  const pointsProvider = {
    actionMode: 'interactive',
    authorize: jest.fn().mockResolvedValue({ status: 'SUCCEEDED', providerTransactionId: 'points-tx' }),
    cancel: jest.fn().mockResolvedValue(undefined),
  };
  const extProvider = {
    actionMode: opts.providerActionMode ?? 'interactive',
    authorize: jest
      .fn()
      .mockResolvedValue(opts.authorizeResult ?? { status: 'REQUIRES_ACTION', nextAction: { type: 'TOSS_CHECKOUT' } }),
  };

  const chargesService = {
    findActiveByIntentAndOperation: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'charge-ext' }),
    findSucceededPointsAuthorizeByIntent: jest.fn().mockResolvedValue(stalePointsCharge),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-key'),
  };

  const paymentMethodsService = {
    findById: jest.fn().mockResolvedValue({ id: 'pm-ext', type: opts.methodType ?? 'TOSS', providerData: {} }),
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

  return { service, pointsProvider, chargesService, updateSet, stateTransitionService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConfirmService', () => {
  it('captures a zero-amount intent without creating charges', async () => {
    const { service, chargesService, stateTransitionService } = makeContext({
      intent: { status: 'CREATED', payableAmount: 0 },
      stalePointsCharge: null,
    });

    await service.confirm('intent-1', { paymentMethodId: null, pointsToApply: undefined }, 'corr-1');

    expect(chargesService.create).not.toHaveBeenCalled();
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'PROCESSING',
      expect.objectContaining({ reasonCode: 'ZERO_AMOUNT_CONFIRM' }),
      undefined,
      expect.anything(),
    );
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'AUTHORIZED',
      expect.objectContaining({ reasonCode: 'ZERO_AMOUNT_AUTHORIZED' }),
      undefined,
      expect.anything(),
    );
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'CAPTURED',
      expect.objectContaining({
        reasonCode: 'ZERO_AMOUNT_CAPTURED',
        outboxEvent: expect.objectContaining({ eventType: 'payment.intent.captured' }),
      }),
      undefined,
      expect.anything(),
    );
  });

  it('rejects points on a zero-amount intent', async () => {
    const { service } = makeContext({
      intent: { status: 'CREATED', payableAmount: 0 },
      stalePointsCharge: null,
    });

    await expect(
      service.confirm('intent-1', { paymentMethodId: null, pointsToApply: 1000 }, 'corr-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'POINTS_NOT_APPLICABLE_TO_ZERO_AMOUNT' }),
    });
  });

  it('finalizes an authorized zero-amount intent as captured on retry', async () => {
    const { service, stateTransitionService } = makeContext({
      intent: { status: 'AUTHORIZED', payableAmount: 0 },
      stalePointsCharge: null,
    });

    await service.confirm('intent-1', { paymentMethodId: null, pointsToApply: undefined }, 'corr-1');

    expect(stateTransitionService.transitionIntent).toHaveBeenCalledTimes(1);
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'CAPTURED',
      expect.objectContaining({
        reasonCode: 'ZERO_AMOUNT_CAPTURED',
        outboxEvent: expect.objectContaining({ eventType: 'payment.intent.captured' }),
      }),
      undefined,
      expect.anything(),
    );
  });

  it('treats an already captured zero-amount intent as a successful no-op', async () => {
    const { service, chargesService, stateTransitionService } = makeContext({
      intent: { status: 'CAPTURED', payableAmount: 0 },
      stalePointsCharge: null,
    });

    await service.confirm('intent-1', { paymentMethodId: null, pointsToApply: undefined }, 'corr-1');

    expect(chargesService.create).not.toHaveBeenCalled();
    expect(stateTransitionService.transitionIntent).not.toHaveBeenCalled();
  });

  it('keeps clamping over-large points on non-zero intents', async () => {
    const { service, chargesService } = makeContext({
      intent: { status: 'CREATED', payableAmount: 1000 },
      stalePointsCharge: null,
    });

    await service.confirm('intent-1', { pointsToApply: 5000 }, 'corr-1');

    expect(chargesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethodId: 'pm-points',
        amount: 1000,
      }),
      expect.anything(),
    );
  });

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

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ actionExpiresAt: expect.any(Date) }));
  });

  it('offline-wait provider enters AWAITING_DEPOSIT and stamps a long deposit expiry (not actionExpiresAt)', async () => {
    const { service, updateSet, stateTransitionService } = makeContext({
      providerActionMode: 'offline-wait',
      authorizeResult: { status: 'REQUIRES_ACTION', nextAction: { type: 'BANK_TRANSFER_PENDING' } },
      methodType: 'BANK_TRANSFER',
    });

    await service.confirm('intent-1', { paymentMethodId: 'pm-ext', pointsToApply: 0 }, 'corr-1');

    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'AWAITING_DEPOSIT',
      expect.objectContaining({ reasonCode: 'AWAITING_DEPOSIT' }),
    );

    const setArgs = updateSet.mock.calls.map((c) => c[0]);
    expect(setArgs).toContainEqual(expect.objectContaining({ expiresAt: expect.any(Date) }));
    expect(setArgs).not.toContainEqual(expect.objectContaining({ actionExpiresAt: expect.any(Date) }));
  });
});
