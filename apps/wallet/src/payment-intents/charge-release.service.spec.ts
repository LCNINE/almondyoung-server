import { HttpException } from '@nestjs/common';
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
  // provider.cancel 은 항상 ChargeResult 를 반환한다(throw 아님). 기본은 성공.
  const provider = { cancel: jest.fn().mockResolvedValue({ status: 'SUCCEEDED' }) };

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

  it('정산완료(SUCCEEDED) 비-CMS charge 취소가 FAILED 를 반환하면 throw 하고 CANCELED 로 덮지 않는다', async () => {
    // TOSS/NICEPAY 빌링처럼 이미 확정된 매출은 provider 취소가 실제 성공해야만 CANCELED 로 전이할 수 있다.
    // 실패를 무시하고 CANCELED 로 덮으면 돈은 빠졌는데 취소완료로 보인다.
    const failing = makePointsCharge({ id: 'charge-fail', paymentMethodId: 'pm-1' });
    const rest = makePointsCharge({ id: 'charge-rest', paymentMethodId: 'pm-2' });
    const { service, provider, chargesService } = makeContext({
      succeededCharges: [failing, rest],
    });
    provider.cancel.mockResolvedValueOnce({ status: 'FAILED', errorCode: 'TOSS_CANCEL_REJECTED' });

    await expect(service.releaseIntentCharges(INTENT, 'corr-1')).rejects.toThrow();

    // 첫 charge 취소 실패 시점에 throw → 실패한 charge 를 CANCELED 로 덮지 않는다.
    expect(chargesService.updateStatus).not.toHaveBeenCalledWith('charge-fail', 'CANCELED', {});
  });

  it('does NOT mark a CMS active charge CANCELED and throws when provider cancel fails (W1)', async () => {
    const active = makePointsCharge({ id: 'charge-cms', paymentMethodId: 'pm-cms' });
    const { service, provider, chargesService } = makeContext({
      activeCharge: active,
      methodType: 'CMS_BATCH',
    });
    // cancel은 throw가 아니라 {status:'FAILED'} 값으로 실패를 알린다 (마감 후 취소불가 등).
    provider.cancel.mockResolvedValue({ status: 'FAILED', errorCode: 'CMS_CUTOFF', errorMessage: '마감 후' });

    await expect(service.releaseIntentCharges(INTENT, 'corr-1')).rejects.toThrow();

    expect(provider.cancel).toHaveBeenCalledTimes(1);
    // 효성 출금 삭제 실패 → 내부 charge를 CANCELED로 덮지 않는다 (돈은 살아있는데 취소완료로 보이는 것 방지).
    expect(chargesService.updateStatus).not.toHaveBeenCalledWith('charge-cms', 'CANCELED', {});
  });

  it('throws a 409 HttpException on CMS cutoff so idempotency caches a 4xx, not a 500 (W3)', async () => {
    const active = makePointsCharge({ id: 'charge-cms', paymentMethodId: 'pm-cms' });
    const { service, provider } = makeContext({ activeCharge: active, methodType: 'CMS_BATCH' });
    provider.cancel.mockResolvedValue({ status: 'FAILED', errorCode: 'CMS_CUTOFF', errorMessage: '마감 후' });

    // 도메인 예외(ApplicationException)는 wallet 멱등 인터셉터가 500 으로 캐시한다. 유저/관리자가 마감 후
    // 취소 시 4xx 를 받도록, 던지는 예외는 HttpException(409) 여야 한다.
    const err = await service.releaseIntentCharges(INTENT, 'corr-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(409);
  });

  it('marks a CMS active charge CANCELED only when provider cancel succeeds (W1)', async () => {
    const active = makePointsCharge({ id: 'charge-cms', paymentMethodId: 'pm-cms' });
    const { service, provider, chargesService } = makeContext({
      activeCharge: active,
      methodType: 'CMS_BATCH',
    });
    provider.cancel.mockResolvedValue({ status: 'SUCCEEDED' });

    await service.releaseIntentCharges(INTENT, 'corr-1');

    expect(provider.cancel).toHaveBeenCalledTimes(1);
    expect(chargesService.updateStatus).toHaveBeenCalledWith('charge-cms', 'CANCELED', {});
  });

  // ─── Finding 2: 정산완료 SUCCEEDED CMS charge 는 branch 2 에서도 결과를 검사해야 한다 ───

  it('정산완료 SUCCEEDED CMS charge 취소 실패(CMS_ALREADY_SETTLED) 시 CANCELED 로 덮지 않고 throw', async () => {
    const settled = makePointsCharge({ id: 'charge-cms-settled', paymentMethodId: 'pm-cms' });
    const { service, provider, chargesService } = makeContext({
      succeededCharges: [settled],
      methodType: 'CMS_BATCH',
    });
    provider.cancel.mockResolvedValue({
      status: 'FAILED',
      errorCode: 'CMS_ALREADY_SETTLED',
      errorMessage: '이미 정산 완료',
    });

    await expect(service.releaseIntentCharges(INTENT, 'corr-1')).rejects.toThrow();
    expect(provider.cancel).toHaveBeenCalledTimes(1);
    // 돈은 이미 빠졌는데 취소완료로 보이는 것 방지 — charge 를 CANCELED 로 덮지 않는다.
    expect(chargesService.updateStatus).not.toHaveBeenCalledWith('charge-cms-settled', 'CANCELED', {});
  });

  it('정산완료 CMS 취소 거부는 409 HttpException 이다', async () => {
    const settled = makePointsCharge({ id: 'charge-cms-settled', paymentMethodId: 'pm-cms' });
    const { service, provider } = makeContext({ succeededCharges: [settled], methodType: 'CMS_BATCH' });
    provider.cancel.mockResolvedValue({ status: 'FAILED', errorCode: 'CMS_ALREADY_SETTLED', errorMessage: '이미 정산 완료' });

    const err = await service.releaseIntentCharges(INTENT, 'corr-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(409);
  });

  it('SUCCEEDED CMS charge 취소 성공 시 CANCELED 로 표기한다', async () => {
    const settled = makePointsCharge({ id: 'charge-cms-settled', paymentMethodId: 'pm-cms' });
    const { service, provider, chargesService } = makeContext({ succeededCharges: [settled], methodType: 'CMS_BATCH' });
    provider.cancel.mockResolvedValue({ status: 'SUCCEEDED' });

    await service.releaseIntentCharges(INTENT, 'corr-1');
    expect(chargesService.updateStatus).toHaveBeenCalledWith('charge-cms-settled', 'CANCELED', {});
  });
});
