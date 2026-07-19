import { RecurringBillingService } from './recurring-billing.service';
import { format } from 'date-fns';

/**
 * 관리자 수동 재시도 검증 단위 테스트.
 * 건강한 계약에 발행하면 새 멱등키로 다음 주기 요금이 즉시 실출금되므로,
 * 재시도가 허용되는 상태를 못 박아둔다.
 */
describe('RecurringBillingService.retryContractBilling', () => {
  const today = format(new Date(), 'yyyy-MM-dd');

  function makeService(options: {
    contract?: Record<string, unknown> | null;
    dunning?: Record<string, unknown> | null;
  }) {
    const baseContract = {
      id: 'c1',
      userId: 'u1',
      planId: 'p1',
      nextBillingDate: today,
      paymentProfileId: null,
      isPastDue: false,
      billingRetryCount: 0,
      status: 'ACTIVE',
      autoRenewal: true,
      billingInProgress: false,
    };
    const contract = options.contract === null ? null : { ...baseContract, ...options.contract };
    const billingReader = {
      findContractById: jest.fn().mockResolvedValue(contract),
      findDunningByContractId: jest.fn().mockResolvedValue(options.dunning ?? null),
    };
    const billingManager = {
      processSingleBilling: jest.fn().mockResolvedValue({ success: true, contractId: 'c1' }),
    };

    const service = new RecurringBillingService(
      billingReader as never,
      billingManager as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, billingManager };
  }

  it('청구 예정일 도래(ACTIVE·autoRenewal) → 재시도 진행', async () => {
    const { service, billingManager } = makeService({});
    await service.retryContractBilling('c1');
    expect(billingManager.processSingleBilling).toHaveBeenCalled();
  });

  it('dunning 대기 중이면 미래 청구일이어도 재시도 진행 (attempts 전달)', async () => {
    const { service, billingManager } = makeService({
      contract: { nextBillingDate: '2999-01-01' },
      dunning: { attempts: 2, maxAttempts: 3, nextRetryAt: new Date(), lastErrorCode: null, lastErrorMessage: null },
    });
    await service.retryContractBilling('c1');
    expect(billingManager.processSingleBilling).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), 2);
  });

  it('계약 없음 → 404', async () => {
    const { service } = makeService({ contract: null });
    await expect(service.retryContractBilling('c1')).rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_FOUND' });
  });

  it('CANCELLED 계약 → 거부', async () => {
    const { service, billingManager } = makeService({ contract: { status: 'CANCELLED' } });
    await expect(service.retryContractBilling('c1')).rejects.toMatchObject({ code: 'CONTRACT_NOT_ACTIVE' });
    expect(billingManager.processSingleBilling).not.toHaveBeenCalled();
  });

  it('autoRenewal=false 계약 → 거부', async () => {
    const { service, billingManager } = makeService({ contract: { autoRenewal: false } });
    await expect(service.retryContractBilling('c1')).rejects.toMatchObject({ code: 'AUTO_RENEWAL_DISABLED' });
    expect(billingManager.processSingleBilling).not.toHaveBeenCalled();
  });

  it('청구 진행 중 → 거부', async () => {
    const { service, billingManager } = makeService({ contract: { billingInProgress: true } });
    await expect(service.retryContractBilling('c1')).rejects.toMatchObject({ code: 'BILLING_IN_PROGRESS' });
    expect(billingManager.processSingleBilling).not.toHaveBeenCalled();
  });

  it('미래 청구일 + dunning 없음 → 거부 (건강한 계약 조기 출금 방지)', async () => {
    const { service, billingManager } = makeService({ contract: { nextBillingDate: '2999-01-01' } });
    await expect(service.retryContractBilling('c1')).rejects.toMatchObject({ code: 'BILLING_NOT_DUE' });
    expect(billingManager.processSingleBilling).not.toHaveBeenCalled();
  });
});
