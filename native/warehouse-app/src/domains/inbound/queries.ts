import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { ExpectedArrivalsResult, PutawayPendingResult } from './types';

/**
 * GET /inventory/expected-arrivals?warehouseId=…
 *
 * 예정 단건 조회 API 는 없다. 예정 상세 화면도 이 쿼리를 그대로 재사용해
 * documentId 로 골라 쓴다 — 목록과 상세가 한 캐시를 공유하므로 입고 후 무효화
 * 한 번이 양쪽에 반영된다.
 */
export function useExpectedArrivals(warehouseId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['expected-arrivals', warehouseId],
    enabled: warehouseId !== null,
    queryFn: () => {
      const qs = new URLSearchParams({ warehouseId: warehouseId ?? '' });
      return api.request<ExpectedArrivalsResult>({
        path: `/inventory/expected-arrivals?${qs.toString()}`,
      });
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
export function usePutawayPending(
  warehouseId: string | null,
  days: PutawayDays,
  skuIds?: string[]
) {
  const api = useApiClient();
  const skuFilter = skuIds ? [...new Set(skuIds)].sort().join(',') : undefined;
  const query = useInfiniteQuery({
    queryKey: ['putaway-pending', warehouseId, days, skuFilter],
    enabled: warehouseId !== null && skuFilter !== '',
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: PutawayPendingResult) =>
      page.nextCursor ?? undefined,
    refetchOnMount: 'always',
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ warehouseId: warehouseId ?? '' });
      if (days !== 'all') qs.set('days', String(days));
      if (skuFilter) qs.set('skuIds', skuFilter);
      if (pageParam) qs.set('cursor', pageParam);
      const result = await api.request<PutawayPendingResult>({
        path: `/inbound/putaway/pending?${qs.toString()}`,
      });
      // Old servers ignore the SKU filter. Never open an unrelated receipt or
      // infer absence from their unfiltered, capped response during rollout.
      if (
        skuFilter &&
        (result.nextCursor === undefined ||
          result.items.some((item) => !skuIds!.includes(item.skuId)))
      ) {
        throw new Error(
          '상품별 적치 조회를 사용할 수 없어요. 관리자에게 앱과 서버 업데이트를 확인해 주세요.'
        );
      }
      return result;
    },
  });
  const pages = query.data?.pages;
  const items = pages
    ? [
        ...new Map(
          pages.flatMap((page) => page.items).map((item) => [item.lineId, item])
        ).values(),
      ]
    : [];
  const last = pages?.[pages.length - 1];
  return {
    ...query,
    data: last ? { ...last, total: items.length, items } : undefined,
  };
}
