import { Modules } from '@medusajs/framework/utils';
import { buildUsageLinks } from '../coupon-usage';

const USED_AT = new Date('2026-08-31T12:00:00.000Z');
const BOTH_ISSUED = new Set(['promo_a', 'promo_b']);

describe('buildUsageLinks', () => {
  it('고객이 쓴 쿠폰마다 링크 갱신 페이로드를 만든다 (둘 다 이미 발급된 경우)', () => {
    expect(buildUsageLinks('cus_1', ['promo_a', 'promo_b'], 'order_1', USED_AT, BOTH_ISSUED)).toEqual([
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
    expect(buildUsageLinks(null, ['promo_a'], 'order_1', USED_AT, new Set(['promo_a']))).toEqual([]);
  });

  it('쿠폰 없는 주문은 빈 배열', () => {
    expect(buildUsageLinks('cus_1', [], 'order_1', USED_AT, new Set())).toEqual([]);
  });

  it('expires_at 은 건드리지 않는다 — 사용했다고 만료가 바뀌지 않는다', () => {
    const [payload] = buildUsageLinks('cus_1', ['promo_a'], 'order_1', USED_AT, new Set(['promo_a']));
    expect(Object.keys((payload as any).data).sort()).toEqual(['order_id', 'used_at']);
  });

  // C1(2026-08-31 최종 리뷰) 회귀 고정 — 이 두 케이스가 지키는 것은 정확히 이 함수의
  // "링크 행을 절대 생성하지 않는다" 불변식이다. public 쿠폰은 발급 사건이 없어 링크 행이
  // 없으므로, 이 필터가 없으면 사용만으로 무기한 인스턴스가 생겨버린다(파일 상단 주석 참고).
  it('발급된 적 없는(=링크 행 없는) 프로모션은 페이로드를 만들지 않는다', () => {
    expect(buildUsageLinks('cus_1', ['promo_a'], 'order_1', USED_AT, new Set())).toEqual([]);
  });

  it('발급된 것과 안 된 것이 섞이면 발급된 것만 남는다', () => {
    const result = buildUsageLinks(
      'cus_1',
      ['promo_a', 'promo_b'],
      'order_1',
      USED_AT,
      new Set(['promo_a']),
    );
    expect(result).toEqual([
      {
        [Modules.CUSTOMER]: { customer_id: 'cus_1' },
        [Modules.PROMOTION]: { promotion_id: 'promo_a' },
        data: { used_at: USED_AT, order_id: 'order_1' },
      },
    ]);
  });
});
