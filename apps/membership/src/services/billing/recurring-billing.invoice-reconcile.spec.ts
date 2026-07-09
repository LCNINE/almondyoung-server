import { RecurringBillingService } from './recurring-billing.service';

/**
 * INVOICE 경로 reconciliation 라우팅 단위 테스트 (ADR-0027).
 * wallet 인보이스 결과 이벤트 유실 시, 멤버십 소유 멱등키로 wallet 인보이스 권위 상태를 되물어
 * 터미널 상태별로 올바른 InvoiceOutcomeHandler 메서드에 위임하는지 검증한다.
 */
describe('RecurringBillingService.reconcileStuckInvoices', () => {
  function makeService(invoice: unknown) {
    const billingReader = {
      findInvoiceContractsForReconcile: jest
        .fn()
        .mockResolvedValue([{ contractId: 'c1', periodStart: '2026-07-01' }]),
    };
    const invoiceOutcomeHandler = {
      handlePaid: jest.fn().mockResolvedValue(undefined),
      handleUncollectible: jest.fn().mockResolvedValue(undefined),
      handleVoided: jest.fn().mockResolvedValue(undefined),
      handleMandateRejected: jest.fn().mockResolvedValue(undefined),
    };
    const paymentClient = { getWalletInvoiceByIdempotencyKey: jest.fn().mockResolvedValue(invoice) };

    const service = new RecurringBillingService(
      billingReader as never,
      {} as never,
      {} as never,
      {} as never,
      invoiceOutcomeHandler as never,
      paymentClient as never,
    );
    return { service, invoiceOutcomeHandler, paymentClient };
  }

  const base = {
    invoiceId: 'inv1',
    subscriberType: 'MEMBERSHIP',
    subscriberRef: 'c1',
    periodStart: '2026-07-01',
    periodEnd: '2026-08-01',
    amount: 10000,
    currency: 'KRW',
    intentId: 'i1',
    attemptCount: 0,
    maxAttempts: 3,
    errorCode: null,
    reason: null,
  };

  it('멱등키를 membership:invoice:<contractId>:<periodStart> 로 조회', async () => {
    const { service, paymentClient } = makeService({ ...base, status: 'OPEN' });
    await service.reconcileStuckInvoices();
    expect(paymentClient.getWalletInvoiceByIdempotencyKey).toHaveBeenCalledWith('membership:invoice:c1:2026-07-01');
  });

  it('PAID → handlePaid 로 위임', async () => {
    const { service, invoiceOutcomeHandler } = makeService({ ...base, status: 'PAID' });
    await service.reconcileStuckInvoices();
    expect(invoiceOutcomeHandler.handlePaid).toHaveBeenCalledWith('c1', 'inv1', '2026-08-01', 10000, 'i1');
  });

  it('UNCOLLECTIBLE → handleUncollectible 로 위임(자격 회수)', async () => {
    const { service, invoiceOutcomeHandler } = makeService({ ...base, status: 'UNCOLLECTIBLE', errorCode: 'INSUFFICIENT' });
    await service.reconcileStuckInvoices();
    expect(invoiceOutcomeHandler.handleUncollectible).toHaveBeenCalledWith('c1', 'inv1', 'INSUFFICIENT');
  });

  it('VOID → handleVoided 로 위임', async () => {
    const { service, invoiceOutcomeHandler } = makeService({ ...base, status: 'VOID', reason: 'CANCEL' });
    await service.reconcileStuckInvoices();
    expect(invoiceOutcomeHandler.handleVoided).toHaveBeenCalledWith('c1', 'inv1', 'CANCEL');
  });

  it('MANDATE_REJECTED → handleMandateRejected 로 위임', async () => {
    const { service, invoiceOutcomeHandler } = makeService({ ...base, status: 'MANDATE_REJECTED', errorCode: 'NO_ACCOUNT' });
    await service.reconcileStuckInvoices();
    expect(invoiceOutcomeHandler.handleMandateRejected).toHaveBeenCalledWith('c1', 'inv1', 'NO_ACCOUNT');
  });

  it('비터미널(ATTEMPTING) → 어떤 핸들러도 호출하지 않고 대기', async () => {
    const { service, invoiceOutcomeHandler } = makeService({ ...base, status: 'ATTEMPTING' });
    await service.reconcileStuckInvoices();
    expect(invoiceOutcomeHandler.handlePaid).not.toHaveBeenCalled();
    expect(invoiceOutcomeHandler.handleUncollectible).not.toHaveBeenCalled();
    expect(invoiceOutcomeHandler.handleVoided).not.toHaveBeenCalled();
    expect(invoiceOutcomeHandler.handleMandateRejected).not.toHaveBeenCalled();
  });

  it('인보이스 없음(커맨드 유실/미발행) → 대기, 핸들러 미호출', async () => {
    const { service, invoiceOutcomeHandler } = makeService(null);
    await service.reconcileStuckInvoices();
    expect(invoiceOutcomeHandler.handlePaid).not.toHaveBeenCalled();
    expect(invoiceOutcomeHandler.handleUncollectible).not.toHaveBeenCalled();
  });
});
