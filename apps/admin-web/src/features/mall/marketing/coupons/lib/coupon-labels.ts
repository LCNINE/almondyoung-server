import type { CouponVisibility } from '@packages/domain-types';

/**
 * 발급 방식(`visibility`)의 표시 문구.
 *
 * 세 벌인 것은 중복이 아니라 **세 표면의 문구가 실제로 다르기 때문**이다 — 목록 배지는
 * 좁아서 «지정발급», 상세는 넓어서 «발급 고객 전용», 생성 드롭다운은 설명까지 붙는다.
 * 셋 다 `Record<CouponVisibility, …>` 라 어휘가 늘면 **여기서 타입 에러가 난다.** 그 전에는
 * `Record<string, …>` 이었고, 그래서 네 번째 값이 생겨도 아무 데서도 에러가 나지 않았다(#488 N3).
 */
export const VISIBILITY_BADGE: Record<CouponVisibility, { label: string; cls: string }> = {
  public: { label: '공개', cls: 'bg-slate-100 text-slate-600' },
  claimable: { label: '발급받기', cls: 'bg-blue-100 text-blue-700' },
  assigned_only: { label: '지정발급', cls: 'bg-purple-100 text-purple-700' },
};

export const VISIBILITY_DETAIL_LABEL: Record<CouponVisibility, string> = {
  public: '공개',
  claimable: '발급받기',
  assigned_only: '발급 고객 전용',
};

export const VISIBILITY_SELECT_LABEL: Record<CouponVisibility, string> = {
  public: '공개 — 모든 로그인 고객에게 노출',
  claimable: '발급받기 — 고객이 직접 발급받아야 사용 가능',
  assigned_only: '발급 고객 전용 — 관리자가 발급한 고객만 사용 가능',
};

/**
 * 어휘 밖 값의 표시.
 *
 * 예전에는 `?? VISIBILITY_LABEL.public` 이라 **모르는 값이 «공개» 로 보였다.** 발급이 제한된
 * 쿠폰을 관리자가 공개로 오인하는 경로였다(#488 N3). 모르면 모른다고 표시한다.
 */
export const UNKNOWN_VISIBILITY = { label: '알 수 없음', cls: 'bg-amber-100 text-amber-700' } as const;

export function visibilityBadge(v: CouponVisibility | null): { label: string; cls: string } {
  return v == null ? UNKNOWN_VISIBILITY : VISIBILITY_BADGE[v];
}

export function visibilityDetailLabel(v: CouponVisibility | null): string {
  return v == null ? UNKNOWN_VISIBILITY.label : VISIBILITY_DETAIL_LABEL[v];
}
