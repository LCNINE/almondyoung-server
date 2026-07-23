import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { SkuSearchItem } from './types';

/**
 * GET /inventory/skus?barcode=…
 * search/advanced 는 name·code 만 보고 바코드를 안 본다 — 스캔 경로는 이 엔드포인트뿐이다.
 * 응답은 배열({items,total} 아님).
 */
export function useSkuByBarcode(barcode: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['sku-by-barcode', barcode],
    enabled: barcode !== null && barcode.length > 0,
    queryFn: () =>
      api.request<SkuSearchItem[]>({
        path: `/inventory/skus?barcode=${encodeURIComponent(barcode ?? '')}`,
      }),
  });
}
