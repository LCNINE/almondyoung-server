import { CancelService } from './cancel.service';

// ─── Test context ─────────────────────────────────────────────────────────────

function makeIntent(
  overrides: Partial<{ id: string; userId: string | null; currency: string; payableAmount: number }> = {},
) {
  return {
    id: overrides.id ?? 'intent-1',
    userId: overrides.userId ?? 'user-1',
    currency: overrides.currency ?? 'KRW',
    payableAmount: overrides.payableAmount ?? 59300,
  };
}

function makeContext() {
  const chargeReleaseService = {
    releaseIntentCharges: jest.fn().mockResolvedValue(undefined),
  };
  const stateTransitionService = {
    transitionIntent: jest.fn().mockResolvedValue(undefined),
  };

  const service = new CancelService(
    chargeReleaseService as never,
    stateTransitionService as never,
  );

  return { service, chargeReleaseService, stateTransitionService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CancelService', () => {
  it('releases the intent charges and transitions the intent to CANCELED', async () => {
    const intent = makeIntent();
    const { service, chargeReleaseService, stateTransitionService } = makeContext();

    await service.cancel(intent as never, 'corr-1');

    // Charge/hold release is delegated to the shared ChargeReleaseService.
    expect(chargeReleaseService.releaseIntentCharges).toHaveBeenCalledWith(intent, 'corr-1');

    // The intent itself is moved to CANCELED with the user-cancel reason.
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'CANCELED',
      expect.objectContaining({ reasonCode: 'USER_CANCELED', triggeredByType: 'USER' }),
    );
  });
});
