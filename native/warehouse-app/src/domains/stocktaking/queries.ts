import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { StocktakingSession, StocktakingSessionDetail, Variance } from './types';

export interface SessionListResult {
  data: StocktakingSession[];
  total: number;
}

/** GET /stocktaking/sessions?warehouseId=… */
export function useStocktakingSessions(warehouseId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['stocktaking-sessions', warehouseId],
    enabled: warehouseId !== null,
    queryFn: () => {
      const qs = new URLSearchParams({ warehouseId: warehouseId ?? '', limit: '50' });
      return api.request<SessionListResult>({ path: `/stocktaking/sessions?${qs.toString()}` });
    },
  });
}

/**
 * GET /stocktaking/sessions/:id — 세션 + 전체 라인 + 진행률.
 * 실사 이어하기의 기반이다(getVariances 는 차이≠0 만 준다).
 */
export function useStocktakingSession(sessionId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['stocktaking-session', sessionId],
    enabled: sessionId !== null,
    queryFn: () =>
      api.request<StocktakingSessionDetail>({ path: `/stocktaking/sessions/${sessionId}` }),
  });
}

/**
 * GET /stocktaking/sessions/:id/variances — 차이(variance != 0) 만.
 *
 * staleTime: Infinity — VarianceReviewScreen 의 완료 게이트는 `!isStale` 로
 * "무효화된 적 없는 신선한 데이터"만 신뢰한다. 기본(유한) staleTime 을 쓰면
 * isStale 이 "무효화됐다"와 "그냥 시간이 지났다" 두 의미를 같이 지는데, 화면을
 * 가만히 열어만 두고 있어도 staleTime 이 지나면 isStale 이 true 로 넘어가면서
 * 아무 변경도 없는데 게이트가 닫힌다(2026-07-24 리뷰에서 재현됨). Infinity 로
 * 두면 isStale 은 오직 invalidateQueries(명시적 무효화)로만 true 가 되므로,
 * 게이트가 뜻하는 "무효화됐을 수도 있다"만 정확히 반영한다.
 */
export function useStocktakingVariances(sessionId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['stocktaking-variances', sessionId],
    enabled: sessionId !== null,
    staleTime: Infinity,
    queryFn: () =>
      api.request<Variance[]>({ path: `/stocktaking/sessions/${sessionId}/variances` }),
  });
}
