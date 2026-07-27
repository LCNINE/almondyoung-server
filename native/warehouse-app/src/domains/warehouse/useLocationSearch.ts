import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { LocationItem } from './types';

export interface LocationSearchResult {
  items: LocationItem[];
  total: number;
}

/**
 * GET /locations/warehouses/:warehouseId?search=…
 * LocationQueryDto.search 는 "코드나 이름"을 본다 — 스캔한 로케이션 코드를
 * locationId 로 바꾸는 유일한 경로다.
 */
export function useLocationSearch(warehouseId: string | null, search: string) {
  const api = useApiClient();
  const term = search.trim();
  return useQuery({
    queryKey: ['location-search', warehouseId, term],
    enabled: warehouseId !== null && term.length > 0,
    placeholderData: keepPreviousData,
    queryFn: () => {
      const qs = new URLSearchParams({ search: term, limit: '20' });
      return api.request<LocationSearchResult>({
        path: `/locations/warehouses/${warehouseId}?${qs.toString()}`,
      });
    },
  });
}
