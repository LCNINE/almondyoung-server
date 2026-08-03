import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { SkuSearchItem } from './types';

export interface SkuSearchParams {
  search: string;
  limit: number;
  offset: number;
  sortBy?: 'name' | 'code';
  sortOrder?: 'asc' | 'desc';
}

export interface SkuSearchResult {
  items: SkuSearchItem[];
  total: number;
}

/**
 * GET /inventory/skus/search/advanced → { items, total }.
 * currentStock/safetyStock 은 advanced 응답에만 존재. 페이지/정렬은 서버 위임.
 */
export function useSkuSearch(params: SkuSearchParams) {
  const api = useApiClient();
  const search = params.search.trim();
  return useQuery({
    queryKey: ['sku-search', search, params.limit, params.offset, params.sortBy, params.sortOrder],
    enabled: search.length > 0,
    placeholderData: keepPreviousData,
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set('search', search);
      qs.set('limit', String(params.limit));
      qs.set('offset', String(params.offset));
      if (params.sortBy) qs.set('sortBy', params.sortBy);
      if (params.sortOrder) qs.set('sortOrder', params.sortOrder);
      return api.request<SkuSearchResult>({
        path: `/inventory/skus/search/advanced?${qs.toString()}`,
      });
    },
  });
}
