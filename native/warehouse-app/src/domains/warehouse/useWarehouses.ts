import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { Warehouse } from './types';

/** GET /inventory/warehouses — 전체 목록(페이지네이션 없음). */
export function useWarehouses() {
  const api = useApiClient();
  return useQuery({
    queryKey: ['warehouses'],
    staleTime: 5 * 60_000, // 창고 목록은 거의 안 바뀐다.
    queryFn: () => api.request<Warehouse[]>({ path: '/inventory/warehouses' }),
  });
}
