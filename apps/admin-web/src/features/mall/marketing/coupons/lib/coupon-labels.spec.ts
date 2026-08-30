import { COUPON_VISIBILITIES } from '@packages/domain-types';
import {
  VISIBILITY_BADGE,
  VISIBILITY_DETAIL_LABEL,
  VISIBILITY_SELECT_LABEL,
  UNKNOWN_VISIBILITY,
  visibilityBadge,
  visibilityDetailLabel,
} from './coupon-labels';

const vocabulary = [...COUPON_VISIBILITIES].sort();

describe('세 라벨 표면은 어휘 전체를 덮는다', () => {
  it('목록 배지', () => {
    expect(Object.keys(VISIBILITY_BADGE).sort()).toEqual(vocabulary);
  });
  it('상세 다이얼로그', () => {
    expect(Object.keys(VISIBILITY_DETAIL_LABEL).sort()).toEqual(vocabulary);
  });
  it('생성 드롭다운', () => {
    expect(Object.keys(VISIBILITY_SELECT_LABEL).sort()).toEqual(vocabulary);
  });
});

describe('오늘의 문구를 그대로 유지한다 — 이 태스크는 표시 문구를 바꾸는 작업이 아니다', () => {
  it('배지', () => {
    expect(VISIBILITY_BADGE.public.label).toBe('공개');
    expect(VISIBILITY_BADGE.claimable.label).toBe('발급받기');
    expect(VISIBILITY_BADGE.assigned_only.label).toBe('지정발급');
  });

  it('상세는 assigned_only 만 문구가 다르다', () => {
    expect(VISIBILITY_DETAIL_LABEL.public).toBe('공개');
    expect(VISIBILITY_DETAIL_LABEL.claimable).toBe('발급받기');
    expect(VISIBILITY_DETAIL_LABEL.assigned_only).toBe('발급 고객 전용');
  });

  it('어휘 밖 값의 문구는 «알 수 없음» 이다 — 이 플랜이 만든 유일한 신규 문구', () => {
    expect(UNKNOWN_VISIBILITY.label).toBe('알 수 없음');
  });

  it('생성 드롭다운은 설명까지 포함한 문구를 그대로 유지한다', () => {
    expect(VISIBILITY_SELECT_LABEL.public).toBe('공개 — 모든 로그인 고객에게 노출');
    expect(VISIBILITY_SELECT_LABEL.claimable).toBe('발급받기 — 고객이 직접 발급받아야 사용 가능');
    expect(VISIBILITY_SELECT_LABEL.assigned_only).toBe('발급 고객 전용 — 관리자가 발급한 고객만 사용 가능');
  });
});

describe('어휘 밖 값은 «공개» 로 렌더되지 않는다 — #488 N3 의 회귀 방어선', () => {
  it('배지', () => {
    expect(visibilityBadge(null)).toEqual(UNKNOWN_VISIBILITY);
    expect(visibilityBadge(null).label).not.toBe('공개');
  });

  it('상세', () => {
    expect(visibilityDetailLabel(null)).toBe(UNKNOWN_VISIBILITY.label);
    expect(visibilityDetailLabel(null)).not.toBe('공개');
  });

  it('어휘 안의 값은 각자의 맵을 그대로 돌려준다', () => {
    for (const v of COUPON_VISIBILITIES) {
      expect(visibilityBadge(v)).toBe(VISIBILITY_BADGE[v]);
      expect(visibilityDetailLabel(v)).toBe(VISIBILITY_DETAIL_LABEL[v]);
    }
  });
});
