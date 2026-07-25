import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { MoveInput } from './types';

export const MOVE_REASONS = ['재배치', '통합', '분산', '기타'] as const;

/**
 * POST /movement/move — 동일 창고 라인 1개 배치 이동.
 * 서버가 출발지 ON_HAND 부족(400)·동일 로케이션 금지·창고 소속을 검증한다.
 */
export function useMoveStock() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MoveInput) =>
      api.request<unknown>({
        method: 'POST',
        path: '/movement/move',
        body: {
          warehouseId: input.warehouseId,
          idempotencyKey: input.idempotencyKey,
          lines: [
            {
              skuId: input.skuId,
              fromLocationId: input.fromLocationId,
              toLocationId: input.toLocationId,
              quantity: input.quantity,
              memo: input.reason,
            },
          ],
        },
        idempotencyKey: input.idempotencyKey,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['location-contents'] });
      void qc.invalidateQueries({ queryKey: ['sku-warehouse-stock'] });
      void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
    },
  });
}
