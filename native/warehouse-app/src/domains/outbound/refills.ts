import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';

/** core `RefillPendingItem` — 채운 줄 중 아직 안 집은 몫 */
export interface RefillPendingItem {
  shipmentLineId: string;
  skuId: string;
  skuName: string;
  sourceLocationId: string;
  locationCode: string;
  qty: number;
}

/** core `RefillPendingBox`(PR A A6) */
export interface RefillPendingBox {
  shipmentId: string;
  trackingNo: string | null;
  recipientMasked: string;
  items: RefillPendingItem[];
}

export function fetchPendingRefills(api: ApiClient, warehouseId: string): Promise<RefillPendingBox[]> {
  return api.request<RefillPendingBox[]>({ path: `/outbound-refills/pending?${new URLSearchParams({ warehouseId }).toString()}` });
}

/** 다른 스테이션의 결품도 보이게 30초마다(U9). 출고·결품 뒤에는 무효화로 바로 갱신된다 */
export const REFILLS_REFRESH_MS = 30_000;

export function usePendingRefills(warehouseId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['outbound-refills', warehouseId],
    enabled: warehouseId !== null,
    queryFn: () => fetchPendingRefills(api, warehouseId ?? ''),
    refetchInterval: REFILLS_REFRESH_MS,
    retry: false,
  });
}
