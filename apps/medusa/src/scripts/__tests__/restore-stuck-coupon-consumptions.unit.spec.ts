import { restoreStuckCouponConsumptions } from '../restore-stuck-coupon-consumptions';

function makeContainer(opts: {
  stuck: Array<{ id: string; cart_id: string }>;
  links: Array<{ cart_id: string }>;
  carts: Array<{ id: string; completed_at: Date | null }>;
}) {
  const service = {
    listStuckConsumptions: jest.fn().mockResolvedValue(opts.stuck),
    restoreGrants: jest.fn(async (ids: string[]) => ids.length),
  };
  const query = {
    graph: jest.fn(async ({ entity }: { entity: string }) =>
      entity === 'order_cart' ? { data: opts.links } : { data: opts.carts },
    ),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const container = {
    resolve: (key: string) => (key === 'promotionMeta' ? service : key === 'query' ? query : logger),
  } as any;
  return { container, service, query, logger };
}

describe('restoreStuckCouponConsumptions — 주문 없는 소모만 되돌린다', () => {
  it('order_cart 링크도 없고 카트도 완료되지 않은 소모만 되돌린다', async () => {
    const { container, service } = makeContainer({
      stuck: [
        { id: 'g_stuck', cart_id: 'cart_abandoned' },
        { id: 'g_ordered', cart_id: 'cart_with_order' },
        { id: 'g_completed', cart_id: 'cart_completed_no_link' },
      ],
      links: [{ cart_id: 'cart_with_order' }],
      carts: [
        { id: 'cart_abandoned', completed_at: null },
        { id: 'cart_with_order', completed_at: new Date() },
        { id: 'cart_completed_no_link', completed_at: new Date() },
      ],
    });

    const summary = await restoreStuckCouponConsumptions(container, { minAgeMs: 0 });

    expect(service.restoreGrants).toHaveBeenCalledWith(['g_stuck']);
    expect(summary).toEqual({ scanned: 3, restored: 1, kept: 2 });
  });

  it('카트 행이 아예 없어도(지워짐) 링크가 없으면 되돌린다', async () => {
    const { container, service } = makeContainer({
      stuck: [{ id: 'g_gone', cart_id: 'cart_gone' }],
      links: [],
      carts: [],
    });
    await restoreStuckCouponConsumptions(container, { minAgeMs: 0 });
    expect(service.restoreGrants).toHaveBeenCalledWith(['g_gone']);
  });

  it('후보가 없으면 조회도 되돌림도 하지 않는다', async () => {
    const { container, service, query } = makeContainer({ stuck: [], links: [], carts: [] });
    const summary = await restoreStuckCouponConsumptions(container, { minAgeMs: 0 });
    expect(summary).toEqual({ scanned: 0, restored: 0, kept: 0 });
    expect(query.graph).not.toHaveBeenCalled();
    expect(service.restoreGrants).not.toHaveBeenCalled();
  });

  it('usedBefore 는 now − minAgeMs 다 (기본 60분)', async () => {
    delete process.env.COUPON_STUCK_MIN_AGE_MINUTES;
    const { container, service } = makeContainer({ stuck: [], links: [], carts: [] });
    const now = new Date('2026-09-10T12:00:00.000Z');
    await restoreStuckCouponConsumptions(container, { now });
    expect(service.listStuckConsumptions).toHaveBeenCalledWith(new Date('2026-09-10T11:00:00.000Z'), 500);
  });
});
