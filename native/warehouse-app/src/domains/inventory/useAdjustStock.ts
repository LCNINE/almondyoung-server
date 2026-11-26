import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../core/data/httpClient';
import { STOCK_ADJUST_PERMISSION_MESSAGE } from '../../core/data/errorMessage';
import { usePermissionReader } from '../../core/operations/useWorkCapabilities';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { WithSummary } from '../../core/operations/pendingWork';

export const ADJUST_REASONS = ['파손', '분실', '발견', '오출고 정정', '제조', '기타'] as const;

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
  const readPermissions = usePermissionReader();

  return useMutation({
    mutationFn: async ({ summary, ...input }: WithSummary<AdjustStockInput>) => {
      const permissions = await readPermissions().catch(() => undefined);

      if (permissions?.stockAdjust === false)
        throw new ApiError(
          STOCK_ADJUST_PERMISSION_MESSAGE,
          403,
          'FORBIDDEN'
        );

      return api.request<unknown>({
        method: 'POST',
        path: '/inventory/stocks/adjust',
        body: input,
        idempotencyKey: input.idempotencyKey,
        summary,
      });
    },
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ['sku-warehouse-stock'] });
      void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
      void qc.invalidateQueries({ queryKey: ['sku-stock-history', input.skuId, input.warehouseId] });
    },
  });
}
