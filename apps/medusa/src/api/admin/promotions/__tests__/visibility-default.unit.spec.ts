import { requiresIssuance, resolveVisibility, VISIBILITY_WHEN_META_MISSING } from '../helpers';

describe('resolveVisibility — 메타가 없을 때의 기본값', () => {
  it('메타 행이 없으면 닫힌 쪽이다', () => {
    expect(VISIBILITY_WHEN_META_MISSING).toBe('assigned_only');
    expect(resolveVisibility(null)).toBe('assigned_only');
    expect(resolveVisibility(undefined)).toBe('assigned_only');
  });

  it('어휘 밖 값도 닫힌 쪽으로 접는다 — «모르는 값이 공개» 가 #488 N3 의 버그였다', () => {
    expect(resolveVisibility({ visibility: 'bogus_value' })).toBe('assigned_only');
  });

  it('행이 있고 컬럼만 비어 있으면 공개다 — 컬럼이 NOT NULL DEFAULT public 이라 그게 의미론이다', () => {
    expect(resolveVisibility({ name: '이름만 있는 행' })).toBe('public');
  });

  it('어휘 안의 값은 그대로 돌려준다', () => {
    expect(resolveVisibility({ visibility: 'public' })).toBe('public');
    expect(resolveVisibility({ visibility: 'claimable' })).toBe('claimable');
    expect(resolveVisibility({ visibility: 'assigned_only' })).toBe('assigned_only');
  });
});

describe('requiresIssuance — 카트 게이트가 묻는 것', () => {
  it('공개가 아니면 발급이 필요하다', () => {
    expect(requiresIssuance({ visibility: 'public' })).toBe(false);
    expect(requiresIssuance({ visibility: 'claimable' })).toBe(true);
    expect(requiresIssuance({ visibility: 'assigned_only' })).toBe(true);
  });

  it('메타가 없으면 발급이 필요하다 — 오늘은 여기서 게이트가 통과했다', () => {
    expect(requiresIssuance(null)).toBe(true);
    expect(requiresIssuance(undefined)).toBe(true);
  });
});
