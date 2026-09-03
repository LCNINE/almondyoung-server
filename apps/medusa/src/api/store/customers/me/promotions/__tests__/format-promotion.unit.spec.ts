import { formatPromotion, type PromotionLike, type PromotionMetaView } from '../format-promotion';
import type { CouponGrantRow } from '../../../../../../modules/promotion-meta/service';

const basePromo: PromotionLike = {
  id: 'promo_1',
  code: 'WELCOME10',
  type: 'standard',
  status: 'active',
  is_automatic: false,
  metadata: null,
  rules: [],
  application_method: {
    id: 'am_1',
    type: 'percentage',
    value: 10,
    target_type: 'order',
    max_quantity: null,
    currency_code: null,
  },
  campaign: {
    campaign_identifier: 'CAMP_WELCOME10_1756400000000',
    starts_at: '2026-08-01T00:00:00.000Z',
    ends_at: '2026-09-01T00:00:00.000Z',
  },
};

const NOW = new Date('2026-09-02T00:00:00.000Z');

/** 이 파일의 대부분 케이스는 grants/usable_count 를 다루지 않는다 — 빈 배열로 둔다. */
const NO_GRANTS: CouponGrantRow[] = [];

const meta = (overrides: Partial<PromotionMetaView> = {}): PromotionMetaView => ({
  visibility: 'public',
  maxDiscountAmount: null,
  expiresAt: null,
  validityDays: null,
  isAssigned: false,
  ...overrides,
});

describe('formatPromotion', () => {
  it('식별 필드를 그대로 옮기고, 발급 여부와 visibility 는 인자를 싣는다', () => {
    const out = formatPromotion(basePromo, meta({ visibility: 'claimable', isAssigned: true }), NO_GRANTS, NOW);
    expect(out).toMatchObject({
      id: 'promo_1',
      code: 'WELCOME10',
      type: 'standard',
      status: 'active',
      is_automatic: false,
      is_assigned: true,
      visibility: 'claimable',
    });
  });

  it('application_method 는 지정한 6개 필드만 싣는다', () => {
    const out = formatPromotion(basePromo, meta(), NO_GRANTS, NOW);
    expect(out.application_method).toEqual({
      id: 'am_1',
      type: 'percentage',
      value: 10,
      target_type: 'order',
      max_quantity: null,
      currency_code: null,
    });
  });

  it('application_method 가 없으면 null 이다', () => {
    const out = formatPromotion({ ...basePromo, application_method: null }, meta(), NO_GRANTS, NOW);
    expect(out.application_method).toBeNull();
  });

  it('campaign 은 식별자와 기간 3개 필드만 싣고, 없으면 null 이다', () => {
    expect(formatPromotion(basePromo, meta(), NO_GRANTS, NOW).campaign).toEqual({
      campaign_identifier: 'CAMP_WELCOME10_1756400000000',
      starts_at: '2026-08-01T00:00:00.000Z',
      ends_at: '2026-09-01T00:00:00.000Z',
    });
    expect(formatPromotion({ ...basePromo, campaign: null }, meta(), NO_GRANTS, NOW).campaign).toBeNull();
  });

  it('min_order_amount 를 subtotal gte 룰에서 뽑는다 — 값이 문자열이든 {value} 객체든', () => {
    const asString = formatPromotion(
      { ...basePromo, rules: [{ attribute: 'subtotal', operator: 'gte', values: ['30000'] }] },
      meta(),
      NO_GRANTS,
      NOW,
    );
    const asObject = formatPromotion(
      { ...basePromo, rules: [{ attribute: 'subtotal', operator: 'gte', values: [{ value: '30000' }] }] },
      meta(),
      NO_GRANTS,
      NOW,
    );
    expect(asString.min_order_amount).toBe(30000);
    expect(asObject.min_order_amount).toBe(30000);
  });

  it('subtotal gte 룰이 없거나 값이 숫자가 아니면 min_order_amount 는 null 이다', () => {
    expect(formatPromotion(basePromo, meta(), NO_GRANTS, NOW).min_order_amount).toBeNull();
    expect(
      formatPromotion(
        { ...basePromo, rules: [{ attribute: 'customer.groups.id', operator: 'in', values: ['cg_1'] }] },
        meta(),
        NO_GRANTS,
        NOW,
      ).min_order_amount,
    ).toBeNull();
    expect(
      formatPromotion(
        { ...basePromo, rules: [{ attribute: 'subtotal', operator: 'gte', values: ['이만원'] }] },
        meta(),
        NO_GRANTS,
        NOW,
      ).min_order_amount,
    ).toBeNull();
  });

  // #488 N2. 스토어 응답의 `metadata` 는 어드민의 합성 metadata 와 이름만 같고 정체가 달랐다 —
  // Medusa 네이티브 json 컬럼이라 쓰는 코드가 0곳이고 값이 항상 null 이었다. 「스토어에 메타가
  // 없다」는 잘못된 진단을 유도했으므로 이름 자체를 비운다. 스토어가 필요로 하는 메타 정보는
  // 최상위 `visibility` 로 이미 나간다.
  it('metadata 를 내리지 않는다 — 네이티브 값이 채워져 있어도 응답에 새지 않는다', () => {
    const out = formatPromotion({ ...basePromo, metadata: { internal: 'x' } }, meta(), NO_GRANTS, NOW);
    expect(out).not.toHaveProperty('metadata');
    expect(JSON.stringify(out)).not.toContain('internal');
  });

  it('visibility 는 스토어가 받는 유일한 메타 정보다 — 항상 최상위 필드로 나간다', () => {
    expect(formatPromotion(basePromo, meta({ visibility: 'assigned_only' }), NO_GRANTS, NOW).visibility).toBe(
      'assigned_only',
    );
  });

  // 응답의 키 집합 자체를 고정한다. 부분일치(`toMatchObject`)만으로는 나중에 누가 `...promo` 를
  // 스프레드하거나 필드를 더해도 스펙이 초록이라, 「무엇이 나가는가」가 다시 검증 밖으로 샌다.
  it('응답 키 집합을 고정한다 — 여기 없는 키는 스토어로 나가지 않는다', () => {
    const out = formatPromotion(basePromo, meta(), NO_GRANTS, NOW);
    expect(Object.keys(out).sort()).toEqual([
      'application_method',
      'campaign',
      'code',
      'expires_at',
      'id',
      'is_assigned',
      'is_automatic',
      'max_discount_amount',
      'min_order_amount',
      'status',
      'type',
      'usable_count',
      'validity_days',
      'visibility',
    ]);
  });
});

describe('최대 할인금액(#488 A4)', () => {
  it('캡이 있으면 응답에 실린다', () => {
    const result = formatPromotion(basePromo, meta({ isAssigned: true, maxDiscountAmount: 30000 }), NO_GRANTS, NOW);
    expect(result.max_discount_amount).toBe(30000);
  });

  it('캡이 없으면 null 이다 — 키를 빼지 않는다(클라가 optional 분기를 안 타게)', () => {
    const result = formatPromotion(basePromo, meta({ isAssigned: true }), NO_GRANTS, NOW);
    expect(result.max_discount_amount).toBeNull();
  });
});

describe('만료 시점 — 링크 행이 있으면 링크 행, 아니면 정책 (#488 결정 1)', () => {
  it('expires_at 을 최상위로 내린다 — 발급된 장이면 링크 행 값이다', () => {
    const out = formatPromotion(
      basePromo,
      meta({ isAssigned: true, visibility: 'assigned_only', expiresAt: '2026-12-31T00:00:00.000Z' }),
      NO_GRANTS,
      NOW,
    );
    expect(out.expires_at).toEqual('2026-12-31T00:00:00.000Z');
  });

  it('무기한이면 null 이다', () => {
    const out = formatPromotion(basePromo, meta(), NO_GRANTS, NOW);
    expect(out.expires_at).toBeNull();
  });
});

// W1 (2026-08-31). `expires_at` 이 null 인 이유가 「무기한」인지 「미발급 validity_days」인지
// 화면이 구분할 수 있게 정책의 validity_days 를 그대로 최상위에 내린다.
describe('validity_days — 「발급 후 N일」을 표시할 수 있도록 노출한다 (W1)', () => {
  it('정책에 validity_days 가 있으면 최상위로 내린다', () => {
    const out = formatPromotion(basePromo, meta({ visibility: 'claimable', validityDays: 30 }), NO_GRANTS, NOW);
    expect(out.validity_days).toBe(30);
  });

  it('정책에 validity_days 가 없으면 null 이다', () => {
    const out = formatPromotion(basePromo, meta(), NO_GRANTS, NOW);
    expect(out.validity_days).toBeNull();
  });
});

// #488 Task 8. 「1장=1회」가 grant 로 강제되므로, 화면은 발급 총수가 아니라 "지금 쓸 수 있는
// 장 수"를 봐야 한다 — 다 쓴 쿠폰도 여전히 목록엔 남을 수 있으므로(예: 만료 목록) usable_count
// 만이 "아직 쓸 수 있는가"를 답한다.
describe('usable_count — 지금 쓸 수 있는 장 수 (#488 Task 8)', () => {
  it('보유 장수를 싣는다', () => {
    const grants: CouponGrantRow[] = [
      {
        id: 'a',
        promotion_id: 'promo_1',
        customer_id: 'c1',
        issue_key: 'k1',
        issued_via: 'admin_manual',
        issued_at: new Date(),
        expires_at: null,
        used_at: null,
        order_id: null,
        revoked_at: null,
      },
      {
        id: 'b',
        promotion_id: 'promo_1',
        customer_id: 'c1',
        issue_key: 'k2',
        issued_via: 'admin_manual',
        issued_at: new Date(),
        expires_at: null,
        used_at: new Date(),
        order_id: 'o1',
        revoked_at: null,
      },
    ];
    const out = formatPromotion(basePromo, meta({ visibility: 'assigned_only', isAssigned: true }), grants, NOW);
    expect(out.usable_count).toBe(1);
  });

  it('사용 가능한 장이 없으면 usable_count 가 0 이다', () => {
    const out = formatPromotion(basePromo, meta(), [], NOW);
    expect(out.usable_count).toBe(0);
  });

  it('만료된 장은 usable_count 에 들어가지 않는다', () => {
    const grants: CouponGrantRow[] = [
      {
        id: 'a',
        promotion_id: 'promo_1',
        customer_id: 'c1',
        issue_key: 'k1',
        issued_via: 'admin_manual',
        issued_at: new Date('2026-01-01T00:00:00.000Z'),
        expires_at: '2026-06-01T00:00:00.000Z',
        used_at: null,
        order_id: null,
        revoked_at: null,
      },
    ];
    const out = formatPromotion(basePromo, meta({ visibility: 'assigned_only', isAssigned: true }), grants, NOW);
    expect(out.usable_count).toBe(0);
  });
});
