import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { PendingPlanListResult } from './types';

/**
 * GET /inbound/pending?warehouseId=…
 *
 * 예정 단건 조회 API 는 없다. 예정 상세 화면도 이 쿼리를 그대로 재사용해
 * planId 로 골라 쓴다 — 목록과 상세가 한 캐시를 공유하므로 입고 후 무효화
 * 한 번이 양쪽에 반영된다.
 */
export function usePendingPlans(warehouseId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['inbound-pending', warehouseId],
    enabled: warehouseId !== null,
    queryFn: () => {
      const qs = new URLSearchParams({ warehouseId: warehouseId ?? '' });
      return api.request<PendingPlanListResult>({ path: `/inbound/pending?${qs.toString()}` });
    },
  });
}
