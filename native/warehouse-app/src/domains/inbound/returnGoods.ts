import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';

/** 반품 검수에서 양품으로 판정돼 반품 자리에 남은 상품 한 줄. */
export interface ReturnGoodsItem {
  skuId: string;
  skuCode: string;
  skuName: string;
  quantity: number;
  usualLocationId: string | null;
  usualLocationCode: string | null;
  /** 평소 선반이 비어 있어 적치하며 정할 수 있다. 옛 서버는 보내지 않는다. */
  canRememberUsual?: boolean;
}

/** GET /inventory/stocks/return-zone 응답. */
export interface ReturnGoods {
  locationId: string;
  locationCode: string;
  warehouseId: string;
  items: ReturnGoodsItem[];
}

export const RETURN_GOODS_KEY = 'return-zone-goods';

export function useReturnGoods(warehouseId: string | null, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [RETURN_GOODS_KEY, warehouseId],
    enabled: enabled && warehouseId !== null,
    queryFn: () =>
      api.request<ReturnGoods>({
        path: `/inventory/stocks/return-zone?${new URLSearchParams({
          warehouseId: warehouseId ?? '',
        }).toString()}`,
      }),
  });
}
