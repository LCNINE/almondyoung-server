import { ChargeReleaseService } from './charge-release.service';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const INTENT = { id: 'intent-1', userId: 'user-1', currency: 'KRW' };

function makePointsCharge(
  overrides: Partial<{ id: string; paymentMethodId: string; amount: number }> = {},
) {
  return {
    id: overrides.id ?? 'charge-points',
    intentId: INTENT.id,
    paymentMethodId: overrides.paymentMethodId ?? 'pm-points',
    amount: overrides.amount ?? 8130,
    currency: 'KRW',
    status: 'SUCCEEDED',
    operation: 'AUTHORIZE',
  };
}

function makeContext(
  options: {
    activeCharge?: ReturnType<typeof makePointsCharge> | null;
    succeededCharges?: ReturnType<typeof makePointsCharge>[];
    methodType?: string;
  } = {},
) {
  const provider = { cancel: jest.fn().mockResolvedValue(undefined) };

  const chargesService = {
    findActiveByIntentAndOperation: jest
      .fn()
      .mockResolvedValue(options.activeCharge ?? null),
    findAllSucceededAuthorizeByIntent: jest
      .fn()
      .mockResolvedValue(options.succeededCharges ?? []),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };

  const paymentMethodsService = {
    findById: jest
      .fn()
      .mockResolvedValue({ id: 'pm-points', type: options.methodType ?? 'POINTS' }),
  };

  const providerRegistry = {
    getProviderOrThrow: jest.fn().mockReturnValue(provider),
  };

  const service = new ChargeReleaseService(
    chargesService as never,
    paymentMethodsService as never,
    providerRegistry as never,
  );

  return { service, provider, chargesService, paymentMethodsService, providerRegistry };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChargeReleaseService', () => {
  it('releases a SUCCEEDED POINTS hold via the points provider and marks it CANCELED', async () => {
    const charge = makePointsCharge();
    const { service, provider, chargesService } = makeContext({
      succeededCharges: [charge],
    });

    await service.releaseIntentCharges(INTENT, 'corr-1');

    expect(provider.cancel).toHaveBeenCalledTimes(1);
    expect(provider.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        chargeId: 'charge-points',
        intentId: 'intent-1',
        paymentMethodId: 'pm-points',
        amount: 8130,
      }),
    );
    expect(chargesService.updateStatus).toHaveBeenCalledWith('charge-points', 'CANCELED', {});
  });

  it('cancels the active AUTHORIZE charge in the DB without a provider call', async () => {
    const active = makePointsCharge({ id: 'charge-active', paymentMethodId: 'pm-toss' });
    const { service, provider, chargesService } = makeContext({ activeCharge: active });

    await service.releaseIntentCharges(INTENT, 'corr-1');

    expect(chargesService.updateStatus).toHaveBeenCalledWith('charge-active', 'CANCELED', {});
    // In-flight charges are cancelled DB-only — no provider refund/cancel for the active charge.
    expect(provider.cancel).not.toHaveBeenCalled();
  });

  it('continues releasing remaining charges when one provider cancel throws', async () => {
    const failing = makePointsCharge({ id: 'charge-fail', paymentMethodId: 'pm-1' });
    const ok = makePointsCharge({ id: 'charge-ok', paymentMethodId: 'pm-2' });
    const { service, provider, chargesService } = makeContext({
      succeededCharges: [failing, ok],
    });
    provider.cancel.mockRejectedValueOnce(new Error('provider boom'));

    await expect(service.releaseIntentCharges(INTENT, 'corr-1')).resolves.toBeUndefined();

    // Both charges were attempted despite the first failing.
    expect(provider.cancel).toHaveBeenCalledTimes(2);
    // The failed charge is left as-is; only the successfully released one is marked CANCELED.
    expect(chargesService.updateStatus).not.toHaveBeenCalledWith('charge-fail', 'CANCELED', {});
    expect(chargesService.updateStatus).toHaveBeenCalledWith('charge-ok', 'CANCELED', {});
  });
});
