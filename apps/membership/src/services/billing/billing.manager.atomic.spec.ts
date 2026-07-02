import { BillingManager } from './billing.manager';

/**
 * lock 선점과 billingIdempotencyKey 저장이 한 UPDATE 로 원자적으로 이뤄지는지 검증.
 * (둘이 분리되면 그 사이 크래시 시 billingInProgress=true·키=null 로 reconciliation 에서 영구 누락)
 */
describe('BillingManager.processSingleBilling — 원자적 lock+key', () => {
  it('lock 선점 UPDATE 의 set() 에 billingIdempotencyKey 가 함께 포함된다', async () => {
    const setCalls: Record<string, unknown>[] = [];
    const db = {
      update: () => ({
        set: (v: Record<string, unknown>) => {
          setCalls.push(v);
          return {
            where: () => ({
              returning: async () => [{ id: 'c1' }], // 선점 성공
            }),
          };
        },
      }),
    };
    const dbService = { db } as never;
    const walletCommandPublisher = { publishBillingCharge: jest.fn().mockResolvedValue(undefined) };
    const planService = {
      getPlanDetails: jest.fn().mockResolvedValue({ plan: { isActive: true, price: 10000, currency: 'KRW' } }),
    };

    const manager = new BillingManager(dbService, walletCommandPublisher as never, planService as never);

    const contract = { id: 'c1', planId: 'p1', nextBillingDate: '2026-07-01' } as never;
    const result = await manager.processSingleBilling(contract, 0);

    expect(result.success).toBe(true);
    // 선점 UPDATE 는 한 번만, 그리고 그 set() 에 lock 플래그와 키가 함께 들어있어야 한다.
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toMatchObject({
      billingInProgress: true,
      billingIdempotencyKey: 'membership:billing:c1:2026-07-01:0',
    });
    expect(walletCommandPublisher.publishBillingCharge).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'membership:billing:c1:2026-07-01:0' }),
    );
  });
});
