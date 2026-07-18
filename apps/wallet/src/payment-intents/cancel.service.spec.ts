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

  it('구독 청구 intent 취소 시 subscriberRef/Type 을 CANCELED 이벤트 payload 에 실어 membership 이 라우팅하게 한다', async () => {
    // Finding 2: 취소 이벤트에 subscriber 정보가 없으면 membership 이 어느 계약인지 몰라 billingInProgress 를
    // 해제하지 못한다. intent.metadata 의 subscriberRef/Type 을 성공/실패 경로와 동일하게 payload 에 실어준다.
    const intent = { ...makeIntent(), metadata: { subscriberRef: 'contract-9', subscriberType: 'MEMBERSHIP', purpose: 'SUBSCRIPTION' } };
    const { service, stateTransitionService } = makeContext();

    await service.cancel(intent as never, 'corr-1');

    const opts = stateTransitionService.transitionIntent.mock.calls[0][2];
    expect(opts.outboxEvent.payload).toMatchObject({ subscriberRef: 'contract-9', subscriberType: 'MEMBERSHIP' });
  });
});
