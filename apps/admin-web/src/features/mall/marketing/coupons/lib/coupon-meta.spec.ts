import type { MedusaPromotion } from '@/lib/api/domains/medusa/promotions';
import { getCouponMeta, toAutoIssueTrigger, AUTO_ISSUE_TRIGGER_LABELS, AUTO_ISSUE_TRIGGERS } from './coupon-meta';

function promo(metadata: Record<string, unknown> | null): MedusaPromotion {
  return {
    id: 'promo_1',
    code: 'WELCOME10',
    type: 'standard',
    status: 'active',
    is_automatic: false,
    campaign_id: null,
    metadata,
  } as MedusaPromotion;
}

describe('getCouponMeta', () => {
  it('메타가 없으면 전부 비어 있고 visibility 는 컬럼 기본값인 public 이다', () => {
    expect(getCouponMeta(promo(null))).toEqual({
      name: undefined,
      maxDiscountAmount: null,
      maxClaims: null,
      issuedCount: null,
      createdBy: undefined,
      visibility: 'public',
      autoIssueTrigger: null,
    });
  });

  it('숫자 필드는 문자열로 와도 숫자로 옮긴다', () => {
    const meta = getCouponMeta(promo({ max_discount_amount: '30000', max_claims: '100', issued_count: '7' }));
    expect(meta.maxDiscountAmount).toBe(30000);
    expect(meta.maxClaims).toBe(100);
    expect(meta.issuedCount).toBe(7);
  });

  it('0 은 없음이 아니다 — issued_count 0 이 null 로 접히면 발급 현황이 사라진다', () => {
    expect(getCouponMeta(promo({ issued_count: 0 })).issuedCount).toBe(0);
  });

  it('어휘 안의 visibility 는 그대로 싣는다', () => {
    expect(getCouponMeta(promo({ visibility: 'claimable' })).visibility).toBe('claimable');
    expect(getCouponMeta(promo({ visibility: 'assigned_only' })).visibility).toBe('assigned_only');
  });

  it('어휘 밖의 visibility 는 null 이다 — public 으로 접지 않는다 (#488 N3)', () => {
    expect(getCouponMeta(promo({ visibility: 'members_only' })).visibility).toBeNull();
  });

  it('어휘 밖의 auto_issue_trigger 는 null 이다 — 라벨 조회가 undefined 를 렌더하지 않게', () => {
    expect(getCouponMeta(promo({ auto_issue_trigger: 'first_purchase' })).autoIssueTrigger).toBeNull();
    expect(getCouponMeta(promo({ auto_issue_trigger: 'birthday' })).autoIssueTrigger).toBe('birthday');
  });
});

describe('toAutoIssueTrigger', () => {
  it('어휘 안의 값만 통과한다', () => {
    for (const t of AUTO_ISSUE_TRIGGERS) {
      expect(toAutoIssueTrigger(t)).toBe(t);
    }
    for (const v of ['first_purchase', '', null, undefined, 7] as unknown[]) {
      expect(toAutoIssueTrigger(v)).toBeNull();
    }
  });
});

describe('AUTO_ISSUE_TRIGGER_LABELS', () => {
  it('트리거 어휘 전체를 덮는다', () => {
    expect(Object.keys(AUTO_ISSUE_TRIGGER_LABELS).sort()).toEqual([...AUTO_ISSUE_TRIGGERS].sort());
  });
});
