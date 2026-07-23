import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';

export const ADJUST_REASONS = ['파손', '분실', '발견', '오출고 정정', '기타'] as const;

export interface AdjustStockInput {
  skuId: string;
  warehouseId: string;
  /** 로케이션은 필수다 — 생략하면 백엔드가 시스템 '입고기본존'으로 밀어넣는다. */
  locationId: string;
  /** 0 은 백엔드가 400 으로 거절한다. 화면에서 먼저 막는다. */
  delta: number;
  reason: string;
  /** 화면 진입 시 1회 생성해 재시도에 재사용한다. */
  idempotencyKey: string;
}

/** POST /inventory/stocks/adjust */
export function useAdjustStock() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AdjustStockInput) =>
      api.request<unknown>({
        method: 'POST',
        path: '/inventory/stocks/adjust',
        body: input,
        idempotencyKey: input.idempotencyKey,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sku-warehouse-stock'] });
      void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
    },
  });
}
