import { REVIEW_PROVIDER_LABELS, type ReviewDto } from '../../../../lib/types/dto/review';

/** ugc-service `source-system.ts` 의 `ADMIN_MANUAL_SOURCE_SYSTEM` 과 같은 값 */
export const ADMIN_MANUAL_SOURCE_SYSTEM = 'admin-manual';
export const ADMIN_MANUAL_LABEL = '관리자 수기 작성';

/**
 * 목록·상세의 「작성 권한」 칸. 관리자 수기 작성분은 권한 행이 없어 provider 로는 「권한 미연결」이
 * 되는데, 그러면 오래된 이관분과 섞여 리테일팀이 자기 입력분을 못 알아본다 — 출처로 먼저 가른다.
 */
export function reviewAuthorityLabel(review: Pick<ReviewDto, 'permission' | 'sourceSystem'>): string {
  if (review.sourceSystem === ADMIN_MANUAL_SOURCE_SYSTEM) return ADMIN_MANUAL_LABEL;
  return REVIEW_PROVIDER_LABELS[review.permission?.provider ?? 'unassigned'];
}
