import handleCouponGrantRestore, { config } from '../coupon-grant-restore';

function makeContainer(service: any, links: Array<{ cart_id: string; order_id: string }> = []) {
  const logger = { info: jest.fn(), error: jest.fn() };
  const query = { graph: jest.fn().mockResolvedValue({ data: links }) };
  return {
    container: {
      resolve: (key: string) => {
        if (key === 'promotionMeta') return service;
        if (key === 'query') return query;
        return logger;
      },
    },
    logger,
    query,
  };
}

describe('coupon-grant-restore 구독자', () => {
  it('order.canceled 에 등록된다', () => {
    expect(config.event).toBe('order.canceled');
  });

  it('주문 → order_cart 링크 → 카트로 복구를 부른다', async () => {
    const service = { restoreGrantsByCart: jest.fn().mockResolvedValue(2) };
    const { container, query } = makeContainer(service, [{ cart_id: 'cart_1', order_id: 'order_1' }]);
    await handleCouponGrantRestore({ event: { data: { id: 'order_1' } }, container } as any);

    expect(query.graph).toHaveBeenCalledWith({
      entity: 'order_cart',
      fields: ['cart_id', 'order_id'],
      filters: { order_id: 'order_1' },
    });
    expect(service.restoreGrantsByCart).toHaveBeenCalledWith('cart_1', expect.any(Date));
  });

  it('링크가 없는 주문(옛 주문)은 복구 대상이 없다 — order_id 폴백은 없다', async () => {
    const service = { restoreGrantsByCart: jest.fn() };
    const { container, logger } = makeContainer(service, []);
    await handleCouponGrantRestore({ event: { data: { id: 'order_legacy' } }, container } as any);

    expect(service.restoreGrantsByCart).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('주문 id 가 없으면 아무것도 하지 않는다', async () => {
    const service = { restoreGrantsByCart: jest.fn() };
    const { container, query } = makeContainer(service);
    await handleCouponGrantRestore({ event: { data: {} }, container } as any);

    expect(query.graph).not.toHaveBeenCalled();
    expect(service.restoreGrantsByCart).not.toHaveBeenCalled();
  });

  it('복구가 실패해도 던지지 않는다 — 취소를 막으면 안 된다', async () => {
    const service = { restoreGrantsByCart: jest.fn().mockRejectedValue(new Error('db down')) };
    const { container, logger } = makeContainer(service, [{ cart_id: 'cart_2', order_id: 'order_2' }]);

    await expect(
      handleCouponGrantRestore({ event: { data: { id: 'order_2' } }, container } as any),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('cart_2'));
  });
});
