import { ADMIN_MANUAL_LABEL, ADMIN_MANUAL_SOURCE_SYSTEM } from './review-provenance';

type TabParam = 'provider' | 'sourceSystem';

export const REVIEW_TABS: ReadonlyArray<{ key: string; label: string; param?: TabParam }> = [
  { key: '', label: '전체' },
  { key: 'order', label: '주문 권한 리뷰', param: 'provider' },
  { key: 'admin', label: '관리자 권한 리뷰', param: 'provider' },
  { key: 'unassigned', label: '권한 미연결', param: 'provider' },
  { key: ADMIN_MANUAL_SOURCE_SYSTEM, label: ADMIN_MANUAL_LABEL, param: 'sourceSystem' },
];

export function activeReviewTab(params: URLSearchParams): string {
  if (params.get('sourceSystem') === ADMIN_MANUAL_SOURCE_SYSTEM) return ADMIN_MANUAL_SOURCE_SYSTEM;
  return params.get('provider') ?? '';
}

/**
 * 탭은 권한(provider)과 출처(sourceSystem) 두 축에 걸친다. 한쪽 탭으로 옮길 때 다른 축 값이 남으면
 * 두 조건이 AND 로 걸려 0건이 된다 — 탭 전환은 두 축과 배치·페이지를 모두 비우고 하나만 다시 건다.
 */
export function nextReviewTabParams(params: URLSearchParams, key: string): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  next.delete('provider');
  next.delete('sourceSystem');
  next.delete('batchId');
  next.delete('page');

  const tab = REVIEW_TABS.find((t) => t.key === key);
  if (tab?.param) next.set(tab.param, tab.key);
  return next;
}
