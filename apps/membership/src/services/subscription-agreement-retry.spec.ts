import { SubscriptionService } from './subscription.service';

/**
 * wallet 의 HttpIdempotencyInterceptor 는 «실패 응답도» FAILED 로 저장하고 TTL 동안 replay 한다
 * (apps/wallet/src/domain/idempotency/idempotency.service.ts 의 FAILED 분기).
 *
 * 그래서 재시도가 같은 HTTP 멱등키를 쓰면 2회차가 wallet 핸들러에 닿지도 못하고 1회차의 500 을
 * 그대로 되받는다 — 재시도는 이름만 남고, 일시 장애가 곧바로 voidSubscription 으로 간다.
 * 아웃박스 적재를 agreement 트랜잭션에 묶은 뒤로는 그 대가가 「메일 유실」이 아니라 「가입 취소」라
 * 더 비싸졌다.
 */
describe('createBillingAgreementWithRetry — HTTP 멱등키', () => {
  function makeService(createBillingAgreement: jest.Mock) {
    const service = Object.create(SubscriptionService.prototype) as SubscriptionService;
    Object.assign(service, {
      paymentClientService: { createBillingAgreement },
      logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    });
    return service;
  }

  // private 메서드를 이름으로 부른다 — 이 규칙을 지키는 지점이 거기 하나뿐이다.
  const callRetry = (service: SubscriptionService, ...args: unknown[]) =>
    (service as unknown as Record<string, (...a: unknown[]) => Promise<void>>).createBillingAgreementWithRetry(...args);

  it('시도마다 «다른» 키를 넘긴다 — 같은 키면 2회차가 1회차의 실패를 replay 한다', async () => {
    const createBillingAgreement = jest
      .fn()
      .mockRejectedValueOnce(new Error('outbox down'))
      .mockResolvedValueOnce(undefined);
    const service = makeService(createBillingAgreement);

    await callRetry(service, 'user-1', 'contract-1', 'method-1', 2, true);

    expect(createBillingAgreement).toHaveBeenCalledTimes(2);
    const keys = createBillingAgreement.mock.calls.map((c) => c[3]);
    expect(keys[0]).toBeDefined();
    expect(keys[1]).toBeDefined();
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('키는 계약 안에서만 갈린다 — 다른 계약과 섞이지 않는다', async () => {
    const createBillingAgreement = jest.fn().mockResolvedValue(undefined);
    const service = makeService(createBillingAgreement);

    await callRetry(service, 'user-1', 'contract-1', 'method-1', 2, true);

    expect(createBillingAgreement.mock.calls[0][3]).toContain('user-1');
    expect(createBillingAgreement.mock.calls[0][3]).toContain('contract-1');
  });
});
