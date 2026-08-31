import { Modules } from '@medusajs/framework/utils';
import { buildUsageLinks } from '../coupon-usage';

const USED_AT = new Date('2026-08-31T12:00:00.000Z');

describe('buildUsageLinks', () => {
  it('고객이 쓴 쿠폰마다 링크 갱신 페이로드를 만든다', () => {
    expect(buildUsageLinks('cus_1', ['promo_a', 'promo_b'], 'order_1', USED_AT)).toEqual([
      {
        [Modules.CUSTOMER]: { customer_id: 'cus_1' },
        [Modules.PROMOTION]: { promotion_id: 'promo_a' },
        data: { used_at: USED_AT, order_id: 'order_1' },
      },
      {
        [Modules.CUSTOMER]: { customer_id: 'cus_1' },
        [Modules.PROMOTION]: { promotion_id: 'promo_b' },
        data: { used_at: USED_AT, order_id: 'order_1' },
      },
    ]);
  });

  it('비회원 주문은 기록할 대상이 없다 — 링크는 고객에게만 붙는다', () => {
    expect(buildUsageLinks(null, ['promo_a'], 'order_1', USED_AT)).toEqual([]);
  });

  it('쿠폰 없는 주문은 빈 배열', () => {
    expect(buildUsageLinks('cus_1', [], 'order_1', USED_AT)).toEqual([]);
  });

  it('expires_at 은 건드리지 않는다 — 사용했다고 만료가 바뀌지 않는다', () => {
    const [payload] = buildUsageLinks('cus_1', ['promo_a'], 'order_1', USED_AT);
    expect(Object.keys((payload as any).data).sort()).toEqual(['order_id', 'used_at']);
  });
});
