import {
  usableGrants,
  hasUsableGrant,
  nextExpiryAt,
  grantsFor,
  grantsGovernUsage,
  latestUsedAt,
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
    cart_id: null,
    revoked_at: null,
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

describe('grantsGovernUsage — 「1장=1회」를 장이 정하는가 (#488 A2)', () => {
  it('장이 있고 발급형 쿠폰이면 장이 정한다', () => {
    const g = [grant({ id: 'a' })];
    expect(grantsGovernUsage(g, 'assigned_only')).toBe(true);
    expect(grantsGovernUsage(g, 'claimable')).toBe(true);
  });

  it('장이 없으면 정책이 정한다 — 발급 개념이 없거나 아직 장이 없는 구식 배정', () => {
    expect(grantsGovernUsage([], 'assigned_only')).toBe(false);
    expect(grantsGovernUsage([], 'public')).toBe(false);
  });

  it('🔴 public 이면 장이 있어도 정책이 정한다 — 직권 발급이 그 고객«만» 잠그지 않게', () => {
    // 이 장 하나 때문에 `hasUsableGrant` 가 false 가 되어, 나머지 고객은 자유롭게 쓰는
    // 쿠폰을 이 고객만 못 쓰게 되던 것이 A2 다. 발급 3경로가 public 을 거절하므로 이 상태는
    // 보통 생기지 않지만, **발급 후 visibility 를 public 으로 바꾸면** 발급 시점 검사로는
    // 못 잡는다 — 게이트에도 같은 판정이 필요한 이유다.
    const spent = [grant({ id: 'a', used_at: NOW })];
    expect(grantsGovernUsage(spent, 'public')).toBe(false);
  });

  it('어휘 밖 visibility 는 발급형으로 본다 — 닫힌 쪽이 기본값이다', () => {
    // 호출부는 `resolveVisibility` 를 거치므로 실제로는 어휘 안 값만 오지만, 그 폴백이
    // 사라져도 여기서 열리지 않게 못 박는다.
    expect(grantsGovernUsage([grant({ id: 'a' })], 'nonsense')).toBe(true);
  });
});

describe('latestUsedAt — 마지막으로 쓴 시각 (#488 A1)', () => {
  it('쓴 장이 없으면 null 이다', () => {
    expect(latestUsedAt([grant({ id: 'a' }), grant({ id: 'b' })])).toBeNull();
  });

  it('여러 번 썼으면 가장 최근 시각이다', () => {
    const g = [
      grant({ id: 'a', used_at: new Date('2026-08-01T00:00:00.000Z') }),
      grant({ id: 'b', used_at: new Date('2026-08-20T00:00:00.000Z') }),
      grant({ id: 'c' }),
    ];
    expect(latestUsedAt(g)).toEqual(new Date('2026-08-20T00:00:00.000Z'));
  });

  it('문자열 used_at 도 읽는다 — 원장 행은 드라이버에 따라 문자열로 온다', () => {
    const g = [grant({ id: 'a', used_at: '2026-08-15T00:00:00.000Z' })];
    expect(latestUsedAt(g)).toEqual(new Date('2026-08-15T00:00:00.000Z'));
  });

  it('파싱 불가한 값은 무시한다 — 없는 것과 같이 취급한다', () => {
    const g = [grant({ id: 'a', used_at: 'not-a-date' })];
    expect(latestUsedAt(g)).toBeNull();
  });
});
