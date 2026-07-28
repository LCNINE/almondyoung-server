import { useMutation, useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { OutboundBatchSummary, ShipmentByWaybill } from './types';

/**
 * GET /shipments/by-waybill?trackingNo=…
 *
 * 스캔 시점에 딱 한 번 부르고 결과로 화면을 이동한다 — 캐시로 붙잡을 이유가
 * 없어서 useQuery 가 아니라 useMutation 이다.
 */
export function useShipmentByWaybill() {
  const api = useApiClient();
  return useMutation({
    mutationFn: (trackingNo: string) => {
      const qs = new URLSearchParams({ trackingNo });
      return api.request<ShipmentByWaybill>({ path: `/shipments/by-waybill?${qs.toString()}` });
    },
  });
}

/**
 * GET /outbound-batches/v2?warehouseId=&status=
 *
 * status 는 서버가 단일 값만 받는다(`listBatches` 가 파생 상태로 후필터). 여러
 * 상태를 보려면 상태별로 훅을 여러 번 쓴다.
 */
export function useOutboundBatches(warehouseId: string | null, status: 'created' | 'picking') {
  const api = useApiClient();
  return useQuery({
    queryKey: ['outbound-batches', warehouseId, status],
    enabled: warehouseId !== null,
    queryFn: () => {
      const qs = new URLSearchParams({ warehouseId: warehouseId ?? '', status });
      return api.request<OutboundBatchSummary[]>({ path: `/outbound-batches/v2?${qs.toString()}` });
    },
  });
}
