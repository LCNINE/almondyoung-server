import { selectGrantIdsToConsume } from '../coupon-usage';
import type { CouponGrantRow } from '../../../../modules/promotion-meta/service';

const NOW = new Date('2026-09-02T00:00:00.000Z');

// 반환 타입을 명시해 `issued_via` 리터럴이 `IssueTrigger` 로 좁혀지게 한다(grants.unit.spec.ts 관례).
function g(over: {
  id: string;
  promotion_id?: string;
  expires_at?: Date | null;
  used_at?: Date | null;
  order_id?: string | null;
}): CouponGrantRow {
  return {
    id: over.id,
    promotion_id: over.promotion_id ?? 'p1',
    customer_id: 'c1',
    issue_key: over.id,
    issued_via: 'admin_manual',
    issued_at: new Date('2026-09-01T00:00:00.000Z'),
    expires_at: over.expires_at ?? null,
    used_at: over.used_at ?? null,
    order_id: over.order_id ?? null,
  };
}

describe('selectGrantIdsToConsume', () => {
  it('프로모션마다 한 장씩 고른다', () => {
    const grants = [g({ id: 'a', promotion_id: 'p1' }), g({ id: 'b', promotion_id: 'p2' })];
    expect(selectGrantIdsToConsume(grants, ['p1', 'p2'], NOW, 'order_1')).toEqual(['a', 'b']);
  });

  it('발급받지 않은 쿠폰은 건너뛴다 — 없는 장을 만들지 않는다', () => {
    expect(selectGrantIdsToConsume([], ['p_public'], NOW, 'order_1')).toEqual([]);
  });

  it('한 프로모션에 2장이 있어도 하나만 고른다', () => {
    const grants = [g({ id: 'a' }), g({ id: 'b' })];
    expect(selectGrantIdsToConsume(grants, ['p1'], NOW, 'order_1')).toHaveLength(1);
  });

  it('이미 소모된 장만 있으면 아무것도 안 고른다', () => {
    expect(selectGrantIdsToConsume([g({ id: 'a', used_at: NOW })], ['p1'], NOW, 'order_1')).toEqual([]);
  });

  // 최종 리뷰 Important #1 — 재실행 멱등성. 링크 upsert 와 달리 grant 소모는 매 호출마다 사용
  // 가능 집합에서 하나를 «고르는» 동작이라, 같은 orderId 로 두 번 불려도 다른 장을 태우지 않도록
  // 구조로 막는다(엔진이 실제로 재호출하는지는 증명하지 않는다 — 값비싸고 업그레이드로 무효화됨).
  describe('재실행 멱등성 (최종 리뷰 Important #1)', () => {
    it('같은 orderId 로 두 번 부르면 두 번째는 빈 배열이다 — 이미 그 주문이 소모한 장이 있으므로', () => {
      const grants = [g({ id: 'a', order_id: 'order_1', used_at: NOW })];
      expect(selectGrantIdsToConsume(grants, ['p1'], NOW, 'order_1')).toEqual([]);
    });

    it('여분 장이 있어도 그렇다 — 이미 소모된 장이 있으면 남은 미사용 장을 또 고르지 않는다', () => {
      const grants = [
        g({ id: 'a', order_id: 'order_1', used_at: NOW }), // order_1 이 이미 소모함
        g({ id: 'b' }), // 여전히 미사용 — 유혹적인 오답 후보
      ];
      expect(selectGrantIdsToConsume(grants, ['p1'], NOW, 'order_1')).toEqual([]);
    });

    it('다른 orderId 로 부르면 남은 장을 정상적으로 고른다 — 가드가 과잉 차단하지 않는다', () => {
      const grants = [g({ id: 'a', order_id: 'order_1', used_at: NOW }), g({ id: 'b' })];
      expect(selectGrantIdsToConsume(grants, ['p1'], NOW, 'order_2')).toEqual(['b']);
    });
  });
});
