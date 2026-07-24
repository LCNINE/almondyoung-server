import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { LocationContents } from './types';

/** GET /inventory/stocks/location/:locationId — 로케이션 내용물(SKU·상태·수량). */
export function useLocationContents(locationId: string | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['location-contents', locationId],
    enabled: Boolean(locationId),
    queryFn: () => api.request<LocationContents>({ path: `/inventory/stocks/location/${locationId}` }),
  });
}
