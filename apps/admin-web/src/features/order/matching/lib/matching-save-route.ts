import type { MatchingStatus } from '@/lib/types/dto/matching';

export type MatchingSaveRoute = 'resolve' | 'upsert';

/**
 * pending 매칭(또는 상태 미확정)은 PATCH resolve 로, 이미 전략이 결정된 matched/ignored
 * 매칭은 PUT upsert 로 라우팅한다.
 */
export function pickCompositionRoute(
  matchingStatus: MatchingStatus | null | undefined
): MatchingSaveRoute {
  return matchingStatus && matchingStatus !== 'pending' ? 'upsert' : 'resolve';
}

/**
 * matched 라인을 비매칭으로 바꿀 때만 전략 변경(changeStrategy) 경로를 쓴다.
 * pending/ignored/미확정 라인은 resolve(resolveAsVoid) 로 처리한다.
 */
export function shouldChangeStrategyForVoid(
  matchingStatus: MatchingStatus | null | undefined
): boolean {
  return matchingStatus === 'matched';
}

export type AutoTabDefaultChoice = 'auto' | 'manual';

/**
 * 다이얼로그가 열릴 때 기본으로 고를 탭. 이미 매칭된(matched) 라인은 manual 이 자연스러운
 * 편집 화면이다 — auto 로 저장하면 PUT upsert 가 기존 SKU 링크를 전부 지우고 다시 넣으므로
 * (product-sku-mapping.service.ts 의 upsert) 저장할 때마다 새 SKU 가 카탈로그에 생기고
 * 직전 SKU 는 링크만 끊긴 채 고아로 남는다. 사용자가 auto 로 «직접» 전환하는 것은 막지
 * 않는다 — 여기서는 기본값만 고른다.
 */
export function pickDefaultTab(
  matchingStatus: MatchingStatus | null | undefined
): AutoTabDefaultChoice {
  return matchingStatus === 'matched' ? 'manual' : 'auto';
}
