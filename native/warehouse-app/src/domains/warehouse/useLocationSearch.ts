import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { LocationItem } from './types';

export interface LocationSearchResult {
  items: LocationItem[];
  total: number;
}

const EMPTY_LOCATION_SEARCH_RESULT: LocationSearchResult = {
  items: [],
  total: 0,
};

export type LocationSearchPurpose =
  'lookup' | 'movement-source' | 'movement-destination' | 'putaway-destination';

/**
 * GET /locations/warehouses/:warehouseId?search=…
 * LocationQueryDto.search 는 "코드나 이름"을 본다 — 스캔한 로케이션 코드를
 * locationId 로 바꾸는 유일한 경로다.
 */
export function useLocationSearch(
  warehouseId: string | null,
  search: string,
  purpose: LocationSearchPurpose = 'lookup',
  { listWhenEmpty = false }: { listWhenEmpty?: boolean } = {}
) {
  const api = useApiClient();
  const term = search.trim();
  const listing = term.length === 0 && listWhenEmpty;

  return useQuery({
    queryKey: ['location-search', warehouseId, term, purpose, listing],
    enabled: warehouseId !== null && (term.length > 0 || listing),
    placeholderData: (previousData, previousQuery) => {
      if (!previousData) return undefined;
      return previousQuery?.queryKey[1] === warehouseId &&
        previousQuery.queryKey[3] === purpose
        ? previousData
        : EMPTY_LOCATION_SEARCH_RESULT;
    },
    queryFn: () => {
      const qs = listing
        ? new URLSearchParams({ limit: '100' })
        : new URLSearchParams({ search: term, limit: '20' });

      if (
        purpose === 'movement-destination' ||
        purpose === 'putaway-destination'
      )
        qs.set('isActive', 'true');
      if (purpose === 'putaway-destination') qs.set('isSystem', 'false');
      return api.request<LocationSearchResult>({
        path: `/locations/warehouses/${warehouseId}?${qs.toString()}`,
      });
    },
  });
}
