import { WelcomeMembershipService } from './welcome-membership.service';

// 청약철회 판정은 웰컴딜 구매 시각이 «그 주기 안인가»로 본다. 구매확정은 다음 주기에 올 수 있으므로
// 호출 시각이 아니라 주문 시각을 적어야 한다.
describe('WelcomeMembershipService.markPurchased — 구매 시각', () => {
  const setup = () => {
    const values: Record<string, unknown>[] = [];
    const db = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          values.push(v);
          return {
            onConflictDoUpdate: (c: { set: Record<string, unknown> }) => (values.push(c.set), Promise.resolve()),
          };
        },
      }),
    };
    const service = new WelcomeMembershipService({ db } as never);
    return { service, values };
  };

  it('주문 시각이 오면 그 시각을 새 행과 갱신 행 모두에 적는다', async () => {
    const { service, values } = setup();
    const orderedAt = new Date('2026-08-30T03:00:00.000Z');
    await service.markPurchased('u1', 'order_1', orderedAt);
    expect(values.map((v) => v.purchasedAt)).toEqual([orderedAt, orderedAt]);
  });

  it('옛 호출자처럼 주문 시각이 없으면 지금 시각으로 적는다', async () => {
    const { service, values } = setup();
    const before = Date.now();
    await service.markPurchased('u1', 'order_1');
    expect((values[0].purchasedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });
});
