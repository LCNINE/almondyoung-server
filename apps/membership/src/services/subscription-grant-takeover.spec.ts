import { SubscriptionService } from './subscription.service';
import {
  ActiveSubscriptionExistsException,
  BadRequestException as SubscriptionBadRequestException,
} from '../shared/exceptions/subscription.exceptions';

describe('subscribeWithBillingMethod — 관리자 임시 지급분이 있을 때', () => {
  function makeService(options: { grantTakeover: unknown; agreementFails?: boolean }) {
    const deps = {
      entitlementService: {
        getUserEntitlement: jest.fn().mockResolvedValue({
          contract: { id: 'grant-contract' },
          entitlement: { endsAt: '2099-01-01' },
        }),
        grantByDays: jest.fn().mockResolvedValue(undefined),
      },
      contractReader: {
        findGrantTakeover: jest.fn().mockResolvedValue(options.grantTakeover),
        findById: jest.fn().mockResolvedValue({ id: 'new-contract' }),
      },
      arrearsGate: { assertNoOutstanding: jest.fn() },
      planService: {
        getPlanDetails: jest
          .fn()
          .mockResolvedValue({ plan: { id: 'p1', isActive: true, price: 10000 }, tier: { id: 't1' } }),
      },
      termsAgreementManager: { resolveForSubscription: jest.fn().mockResolvedValue(null), linkContract: jest.fn() },
      subscriptionCreator: { createNewSubscription: jest.fn().mockResolvedValue({ contractId: 'new-contract' }) },
      subscriptionManager: { voidSubscription: jest.fn() },
      paymentClientService: {
        createBillingAgreement: options.agreementFails
          ? jest.fn().mockRejectedValue(new Error('wallet down'))
          : jest.fn().mockResolvedValue(undefined),
      },
      billingReader: { findContractById: jest.fn().mockResolvedValue(null) },
      membershipEventPublisher: { publishStatusChanged: jest.fn().mockResolvedValue(undefined) },
      configService: { get: jest.fn().mockReturnValue('true') },
      logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    };
    const service = Object.create(SubscriptionService.prototype) as SubscriptionService;
    Object.assign(service, deps);
    return { service, deps };
  }

  const subscribe = (service: SubscriptionService) =>
    service.subscribeWithBillingMethod('u1', 'p1', 'a@b.c', 'bm-1', 'recurring');

  it('결제로 생긴 이용권이면 지금처럼 거절한다', async () => {
    const { service } = makeService({ grantTakeover: null });
    await expect(subscribe(service)).rejects.toBeInstanceOf(ActiveSubscriptionExistsException);
  });

  it('지급분이면 거절하지 않고 이어받아 가입한다', async () => {
    const takeover = { grantContractId: 'grant-contract', remainingDays: 2 };
    const { service, deps } = makeService({ grantTakeover: takeover });

    await subscribe(service);

    expect(deps.subscriptionCreator.createNewSubscription).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'recurring',
      false,
      'INVOICE',
      'a@b.c',
      takeover,
    );
  });

  it('이어받은 뒤 정기결제 설정이 실패하면 void 가 복구를 맡으므로 grantByDays 를 다시 부르지 않는다', async () => {
    const { service, deps } = makeService({
      grantTakeover: { grantContractId: 'grant-contract', remainingDays: 2 },
      agreementFails: true,
    });

    const promise = subscribe(service);
    await expect(promise).rejects.toBeInstanceOf(SubscriptionBadRequestException);
    await expect(promise).rejects.toThrow('정기결제 설정에 실패했습니다');
    expect(deps.subscriptionManager.voidSubscription).toHaveBeenCalled();
    expect(deps.entitlementService.grantByDays).not.toHaveBeenCalled();
  });
});

describe('resumeCmsSignup — 약정 전에 끊긴 서버 가입 잇기', () => {
  const requestedAt = new Date('2026-10-26T05:00:00.000Z');

  function makeService(contract: unknown) {
    const deps = {
      contractReader: { findActiveContract: jest.fn().mockResolvedValue(contract) },
      paymentClientService: { createBillingAgreement: jest.fn().mockResolvedValue(undefined) },
      termsAgreementManager: { linkContract: jest.fn().mockResolvedValue(undefined) },
      logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    };
    const service = Object.create(SubscriptionService.prototype) as SubscriptionService;
    Object.assign(service, deps);
    return { service, deps };
  }

  const invoiceContract = (createdAt: string) => ({
    id: 'c1',
    billingPath: 'INVOICE',
    autoRenewal: true,
    createdAt: new Date(createdAt),
  });

  it('이 요청 뒤에 생긴 계약이면 약정과 약관 연결을 잇는다', async () => {
    const { service, deps } = makeService(invoiceContract('2026-10-26T05:00:01.000Z'));
    await expect(service.resumeCmsSignup('u1', 'bm-1', 'terms-1', requestedAt)).resolves.toBe(true);
    expect(deps.paymentClientService.createBillingAgreement).toHaveBeenCalledWith(
      'u1',
      'c1',
      'bm-1',
      expect.any(String),
      { allowPendingMandate: true },
    );
    expect(deps.termsAgreementManager.linkContract).toHaveBeenCalledWith('u1', 'terms-1', 'c1');
  });

  it('그 전부터 있던 구독은 건드리지 않는다 — 결제수단을 새 계좌로 덮어쓰면 안 된다', async () => {
    const { service, deps } = makeService(invoiceContract('2026-10-20T00:00:00.000Z'));
    await expect(service.resumeCmsSignup('u1', 'bm-1', undefined, requestedAt)).resolves.toBe(false);
    expect(deps.paymentClientService.createBillingAgreement).not.toHaveBeenCalled();
  });
});
