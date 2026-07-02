import { RecurringBillingService } from './recurring-billing.service';

/**
 * reconciliation 라우팅 단위 테스트.
 * wallet 결과 이벤트 유실 시, 저장된 멱등키로 wallet 권위 상태를 되물어 상태별로 올바른 결과 핸들러에
 * 위임하는지 검증한다. (금전 이동 경로이므로 상태별 분기를 못 박아둔다)
 */
describe('RecurringBillingService.reconcileStuckBillings', () => {
  function makeService(intent: unknown) {
    const billingReader = {
      findStuckBillingForReconcile: jest
        .fn()
        .mockResolvedValue([{ contractId: 'c1', idempotencyKey: 'membership:billing:c1:2026-07-01:0' }]),
    };
    const billingManager = { releaseBillingLock: jest.fn().mockResolvedValue(undefined) };
    const billingOutcomeHandler = {
      handleSuccess: jest.fn().mockResolvedValue(undefined),
      handleFailure: jest.fn().mockResolvedValue(undefined),
      handleCanceled: jest.fn().mockResolvedValue(undefined),
    };
    const paymentClient = { getWalletIntentByIdempotencyKey: jest.fn().mockResolvedValue(intent) };

    const service = new RecurringBillingService(
      billingReader as never,
      billingManager as never,
      billingOutcomeHandler as never,
      paymentClient as never,
    );
    return { service, billingManager, billingOutcomeHandler };
  }

  it('CAPTURED → handleSuccess 로 위임', async () => {
    const { service, billingOutcomeHandler } = makeService({ id: 'i1', status: 'CAPTURED', payableAmount: 10000 });
    await service.reconcileStuckBillings();
    expect(billingOutcomeHandler.handleSuccess).toHaveBeenCalledWith('c1', 10000, 'i1');
  });

  it('FAILED → handleFailure 로 위임', async () => {
    const { service, billingOutcomeHandler } = makeService({ id: 'i1', status: 'FAILED', payableAmount: 10000 });
    await service.reconcileStuckBillings();
    expect(billingOutcomeHandler.handleFailure).toHaveBeenCalledWith('c1', 'RECONCILED_FAILED', expect.any(String), 'i1');
  });

  it('CANCELED → handleCanceled 로 위임', async () => {
    const { service, billingOutcomeHandler } = makeService({ id: 'i1', status: 'CANCELED', payableAmount: 10000 });
    await service.reconcileStuckBillings();
    expect(billingOutcomeHandler.handleCanceled).toHaveBeenCalledWith('c1', 'i1');
  });

  it('진행 중(PENDING_SETTLEMENT) → 아무 핸들러도 호출하지 않고 대기', async () => {
    const { service, billingOutcomeHandler, billingManager } = makeService({
      id: 'i1',
      status: 'PENDING_SETTLEMENT',
      payableAmount: 10000,
    });
    await service.reconcileStuckBillings();
    expect(billingOutcomeHandler.handleSuccess).not.toHaveBeenCalled();
    expect(billingOutcomeHandler.handleFailure).not.toHaveBeenCalled();
    expect(billingOutcomeHandler.handleCanceled).not.toHaveBeenCalled();
    expect(billingManager.releaseBillingLock).not.toHaveBeenCalled();
  });

  it('intent 없음(커맨드 유실) → 락 해제, 핸들러 미호출', async () => {
    const { service, billingOutcomeHandler, billingManager } = makeService(null);
    await service.reconcileStuckBillings();
    expect(billingManager.releaseBillingLock).toHaveBeenCalledWith('c1');
    expect(billingOutcomeHandler.handleSuccess).not.toHaveBeenCalled();
  });
});
