import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { SkuSearchItem } from './types';

/** GET /inventory/skus?name=<q> → SkuResponseDto[] (부분집합으로 수신). */
export function useSkuSearch(query: string) {
  const api = useApiClient();
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['sku-search', trimmed],
    enabled: trimmed.length > 0,
    queryFn: () =>
      api.request<SkuSearchItem[]>({
        path: `/inventory/skus?name=${encodeURIComponent(trimmed)}`,
      }),
  });
}
