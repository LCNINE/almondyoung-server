import {
  usableGrants,
  hasUsableGrant,
  selectGrantToConsume,
  nextExpiryAt,
  grantsFor,
} from '../grants';
import type { CouponGrantRow } from '../service';

const NOW = new Date('2026-09-02T00:00:00.000Z');

function grant(over: Partial<CouponGrantRow> & { id: string }): CouponGrantRow {
  return {
    promotion_id: 'promo_1',
    customer_id: 'cus_1',
    issue_key: over.id,
    issued_via: 'admin_manual',
    issued_at: new Date('2026-09-01T00:00:00.000Z'),
    expires_at: null,
    used_at: null,
    order_id: null,
    ...over,
  };
}

describe('usableGrants', () => {
  it('사용된 장을 제외한다', () => {
    const g = [grant({ id: 'a' }), grant({ id: 'b', used_at: NOW })];
    expect(usableGrants(g, NOW).map((x) => x.id)).toEqual(['a']);
  });

  it('만료된 장을 제외한다', () => {
    const g = [
      grant({ id: 'a', expires_at: new Date('2026-09-01T23:59:59.000Z') }),
      grant({ id: 'b', expires_at: new Date('2026-09-03T00:00:00.000Z') }),
    ];
    expect(usableGrants(g, NOW).map((x) => x.id)).toEqual(['b']);
  });

  it('만료 시각이 정확히 now 면 아직 쓸 수 있다 — 경계는 포함이다', () => {
    const g = [grant({ id: 'a', expires_at: NOW })];
    expect(usableGrants(g, NOW)).toHaveLength(1);
  });

  it('expires_at 이 null 이면 무기한이다', () => {
    expect(usableGrants([grant({ id: 'a' })], NOW)).toHaveLength(1);
  });

  it('문자열로 온 날짜도 읽는다', () => {
    const g = [grant({ id: 'a', expires_at: '2026-09-01T00:00:00.000Z' })];
    expect(usableGrants(g, NOW)).toHaveLength(0);
  });
});

describe('selectGrantToConsume — FEFO', () => {
  it('만료가 이른 장을 먼저 고른다', () => {
    const g = [
      grant({ id: 'late', expires_at: new Date('2026-09-30T00:00:00.000Z') }),
      grant({ id: 'soon', expires_at: new Date('2026-09-05T00:00:00.000Z') }),
    ];
    expect(selectGrantToConsume(g, NOW)?.id).toBe('soon');
  });

  it('무기한 장은 맨 뒤다', () => {
    const g = [
      grant({ id: 'forever', expires_at: null }),
      grant({ id: 'dated', expires_at: new Date('2026-12-31T00:00:00.000Z') }),
    ];
    expect(selectGrantToConsume(g, NOW)?.id).toBe('dated');
  });

  it('만료가 같으면 먼저 발급된 장을 고른다', () => {
    const exp = new Date('2026-09-10T00:00:00.000Z');
    const g = [
      grant({ id: 'new', expires_at: exp, issued_at: new Date('2026-09-02T00:00:00.000Z') }),
      grant({ id: 'old', expires_at: exp, issued_at: new Date('2026-08-01T00:00:00.000Z') }),
    ];
    expect(selectGrantToConsume(g, NOW)?.id).toBe('old');
  });

  it('만료도 발급시각도 같으면 id 오름차순 — 결정적이어야 한다', () => {
    const exp = new Date('2026-09-10T00:00:00.000Z');
    const at = new Date('2026-08-01T00:00:00.000Z');
    const g = [
      grant({ id: 'b', expires_at: exp, issued_at: at }),
      grant({ id: 'a', expires_at: exp, issued_at: at }),
    ];
    expect(selectGrantToConsume(g, NOW)?.id).toBe('a');
  });

  it('쓸 수 있는 장이 없으면 null 이다', () => {
    expect(selectGrantToConsume([grant({ id: 'a', used_at: NOW })], NOW)).toBeNull();
    expect(selectGrantToConsume([], NOW)).toBeNull();
  });
});

describe('hasUsableGrant', () => {
  it('한 장이라도 쓸 수 있으면 true', () => {
    const g = [grant({ id: 'a', used_at: NOW }), grant({ id: 'b' })];
    expect(hasUsableGrant(g, NOW)).toBe(true);
  });

  it('전부 소모됐으면 false', () => {
    expect(hasUsableGrant([grant({ id: 'a', used_at: NOW })], NOW)).toBe(false);
  });

  it('빈 배열은 false — 발급받지 않았다는 뜻이다', () => {
    expect(hasUsableGrant([], NOW)).toBe(false);
  });
});

describe('nextExpiryAt', () => {
  it('사용 가능한 장 중 가장 이른 만료를 돌려준다', () => {
    const g = [
      grant({ id: 'a', expires_at: new Date('2026-09-20T00:00:00.000Z') }),
      grant({ id: 'b', expires_at: new Date('2026-09-10T00:00:00.000Z') }),
    ];
    expect(nextExpiryAt(g, NOW)?.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });

  it('무기한 장만 있으면 null 이다', () => {
    expect(nextExpiryAt([grant({ id: 'a' })], NOW)).toBeNull();
  });

  it('사용 가능한 장이 없으면 null 이다', () => {
    expect(nextExpiryAt([grant({ id: 'a', used_at: NOW })], NOW)).toBeNull();
  });
});

describe('grantsFor', () => {
  it('프로모션으로 좁힌다', () => {
    const g = [grant({ id: 'a' }), grant({ id: 'b', promotion_id: 'promo_2' })];
    expect(grantsFor(g, 'promo_2').map((x) => x.id)).toEqual(['b']);
  });
});
