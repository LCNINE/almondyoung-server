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

/** GET /stocktaking/sessions/:id/variances — 차이(variance != 0) 만. */
export function useStocktakingVariances(sessionId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['stocktaking-variances', sessionId],
    enabled: sessionId !== null,
    queryFn: () =>
      api.request<Variance[]>({ path: `/stocktaking/sessions/${sessionId}/variances` }),
  });
}
