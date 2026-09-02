import { selectGrantIdsToConsume } from '../coupon-usage';
import type { CouponGrantRow } from '../../../../modules/promotion-meta/service';

const NOW = new Date('2026-09-02T00:00:00.000Z');

// 반환 타입을 명시해 `issued_via` 리터럴이 `IssueTrigger` 로 좁혀지게 한다(grants.unit.spec.ts 관례).
function g(over: {
  id: string;
  promotion_id?: string;
  expires_at?: Date | null;
  used_at?: Date | null;
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
    order_id: null,
  };
}

describe('selectGrantIdsToConsume', () => {
  it('프로모션마다 한 장씩 고른다', () => {
    const grants = [g({ id: 'a', promotion_id: 'p1' }), g({ id: 'b', promotion_id: 'p2' })];
    expect(selectGrantIdsToConsume(grants, ['p1', 'p2'], NOW)).toEqual(['a', 'b']);
  });

  it('발급받지 않은 쿠폰은 건너뛴다 — 없는 장을 만들지 않는다', () => {
    expect(selectGrantIdsToConsume([], ['p_public'], NOW)).toEqual([]);
  });

  it('한 프로모션에 2장이 있어도 하나만 고른다', () => {
    const grants = [g({ id: 'a' }), g({ id: 'b' })];
    expect(selectGrantIdsToConsume(grants, ['p1'], NOW)).toHaveLength(1);
  });

  it('이미 소모된 장만 있으면 아무것도 안 고른다', () => {
    expect(selectGrantIdsToConsume([g({ id: 'a', used_at: NOW })], ['p1'], NOW)).toEqual([]);
  });
});
