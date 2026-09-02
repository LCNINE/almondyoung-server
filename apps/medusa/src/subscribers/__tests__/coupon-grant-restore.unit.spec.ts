import handleCouponGrantRestore, { config } from '../coupon-grant-restore';

function makeContainer(service: any) {
  return {
    resolve: (key: string) => (key === 'promotionMeta' ? service : { info: jest.fn(), error: jest.fn() }),
  };
}

describe('coupon-grant-restore 구독자', () => {
  it('order.canceled 에 등록된다', () => {
    expect(config.event).toBe('order.canceled');
  });

  it('주문 id 로 복구를 부른다', async () => {
    const service = { restoreGrantsByOrder: jest.fn().mockResolvedValue(2) };
    await handleCouponGrantRestore({
      event: { data: { id: 'order_1' } },
      container: makeContainer(service),
    } as any);

    expect(service.restoreGrantsByOrder).toHaveBeenCalledWith('order_1', expect.any(Date));
  });

  it('주문 id 가 없으면 아무것도 하지 않는다', async () => {
    const service = { restoreGrantsByOrder: jest.fn() };
    await handleCouponGrantRestore({ event: { data: {} }, container: makeContainer(service) } as any);

    expect(service.restoreGrantsByOrder).not.toHaveBeenCalled();
  });

  it('복구가 실패해도 던지지 않는다 — 취소를 막으면 안 된다', async () => {
    const service = { restoreGrantsByOrder: jest.fn().mockRejectedValue(new Error('db down')) };

    await expect(
      handleCouponGrantRestore({
        event: { data: { id: 'order_2' } },
        container: makeContainer(service),
      } as any),
    ).resolves.toBeUndefined();
  });
});
