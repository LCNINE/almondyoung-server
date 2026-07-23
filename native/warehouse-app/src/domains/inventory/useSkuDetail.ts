import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { SkuDetail, SkuStockSummary, SkuWarehouseStock } from './types';

/** GET /inventory/skus/:id */
export function useSkuDetail(skuId: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['sku-detail', skuId],
    queryFn: () => api.request<SkuDetail>({ path: `/inventory/skus/${skuId}` }),
  });
}

/** GET /inventory/skus/:id/stock-summary — 전 창고 합계 + 창고별. */
export function useSkuStockSummary(skuId: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['sku-stock-summary', skuId],
    queryFn: () => api.request<SkuStockSummary>({ path: `/inventory/skus/${skuId}/stock-summary` }),
  });
}

/**
 * GET /inventory/stocks/sku/:skuId/warehouse/:warehouseId
 * 한 번의 호출로 창고 요약 + 위치별 details[] 를 준다(details 의 locationCode 는
 * Task 1 에서 추가됐다). quantity === 0 행 제외는 소비하는 화면의 몫이다.
 */
export function useSkuWarehouseStock(skuId: string, warehouseId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['sku-warehouse-stock', skuId, warehouseId],
    enabled: warehouseId !== null,
    queryFn: () =>
      api.request<SkuWarehouseStock>({
        path: `/inventory/stocks/sku/${skuId}/warehouse/${warehouseId}`,
      }),
  });
}
