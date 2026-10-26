import { SubscriptionService } from './subscription.service';
import { ActiveSubscriptionExistsException } from '../shared/exceptions/subscription.exceptions';

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

    const args = deps.subscriptionCreator.createNewSubscription.mock.calls[0];
    expect(args[args.length - 1]).toEqual(takeover);
  });

  it('이어받은 뒤 정기결제 설정이 실패하면 남은 지급 일수를 돌려준다', async () => {
    const { service, deps } = makeService({
      grantTakeover: { grantContractId: 'grant-contract', remainingDays: 2 },
      agreementFails: true,
    });

    await expect(subscribe(service)).rejects.toThrow('정기결제 설정에 실패했습니다');
    expect(deps.subscriptionManager.voidSubscription).toHaveBeenCalled();
    expect(deps.entitlementService.grantByDays).toHaveBeenCalledWith('u1', 2, expect.any(String), 'SYSTEM');
  });
});
