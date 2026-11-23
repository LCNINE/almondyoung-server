import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';

/** 한 위치에서 한 상품을 집는 일 — 남은 상자 몫을 합친 수량 */
export interface PickListRow {
  locationCode: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  qty: number;
  /** 그중 이미 집은 수량 */
  pickedQty: number;
  boxes: number;
}

export interface BatchPickList {
  batchId: string;
  batchNumber: string;
  /** null 이면 시작 전이라 배정이 없다 */
  startedAt: string | null;
  boxes: number;
  /** 위치 코드 순 — 송장에 찍히는 위치와 같다 */
  rows: PickListRow[];
}

export function fetchBatchPickList(
  api: ApiClient,
  batchId: string
): Promise<BatchPickList> {
  return api.request<BatchPickList>({
    path: `/outbound-batches/${batchId}/pick-list`,
  });
}

/** 열 때마다 새로 받는다 — 종이에 옮길 목록이라 이전 화면의 캐시를 쓰지 않는다 */
export function useBatchPickList(batchId: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['batch-pick-list', batchId],
    queryFn: () => fetchBatchPickList(api, batchId),
    refetchOnMount: 'always',
  });
}

export const remainingOf = (row: PickListRow) =>
  Math.max(0, row.qty - row.pickedQty);
