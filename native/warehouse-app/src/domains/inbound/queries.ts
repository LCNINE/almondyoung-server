import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { PendingPlanListResult, PutawayPendingResult } from './types';

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

/** 큐 기간 필터. 'all' 은 days 파라미터를 아예 안 보낸다. */
export type PutawayDays = 1 | 7 | 'all';

/**
 * GET /inbound/putaway/pending
 *
 * days 는 달력일이 아니라 rolling(now − N×24h)이다 — 야간 조가 자정을 넘겨도
 * 방금 입고한 물건이 큐에서 사라지지 않게.
 */
export function usePutawayPending(warehouseId: string | null, days: PutawayDays) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['putaway-pending', warehouseId, days],
    enabled: warehouseId !== null,
    queryFn: () => {
      const qs = new URLSearchParams({ warehouseId: warehouseId ?? '' });
      if (days !== 'all') qs.set('days', String(days));
      return api.request<PutawayPendingResult>({
        path: `/inbound/putaway/pending?${qs.toString()}`,
      });
    },
  });
}
