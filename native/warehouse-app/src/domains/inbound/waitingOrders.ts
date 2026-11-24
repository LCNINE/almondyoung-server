import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { ApiError } from '../../core/data/httpClient';
import { loadFailed } from '../../core/data/loadFailed';

/** 선반에 있는 재고로는 아직 못 나가는 주문. 적치하면 줄어든다. */
export interface WaitingOrders {
  skuId: string;
  orders: number;
  qty: number;
}

export const WAITING_ORDERS_KEY = 'waiting-orders';

const MAX_SKU_IDS = 100;

export function waitingOrdersLabel(waiting: WaitingOrders): string {
  return `기다리는 주문 ${waiting.orders}건 · ${waiting.qty}개`;
}

/**
 * GET /waiting-orders — 입고·적치를 거들 뿐이라 실패해도 작업을 막지 않는다.
 * 이 경로를 모르는 옛 서버(404)에서는 아무것도 보이지 않는다.
 */
export function useWaitingOrders(
  warehouseId: string | null,
  skuIds: readonly string[]
) {
  const api = useApiClient();
  const ids = [...new Set(skuIds)].sort();
  const query = useQuery({
    queryKey: [WAITING_ORDERS_KEY, warehouseId, ids.join(',')],
    enabled: warehouseId !== null && ids.length > 0,
    refetchOnMount: 'always',
    // 담은 상품이 늘 때마다 이미 본 숫자가 사라졌다 다시 나오지 않게 — 다른 창고 것은 쓰지 않는다
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === warehouseId ? previous : undefined,
    queryFn: async (): Promise<WaitingOrders[]> => {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += MAX_SKU_IDS)
        chunks.push(ids.slice(i, i + MAX_SKU_IDS));
      try {
        const pages = await Promise.all(
          chunks.map((chunk) =>
            api.request<{ items: WaitingOrders[] }>({
              path: `/waiting-orders?${new URLSearchParams({
                warehouseId: warehouseId ?? '',
                skuIds: chunk.join(','),
              }).toString()}`,
            })
          )
        );
        return pages.flatMap((page) => {
          if (!Array.isArray(page?.items))
            throw new Error('waiting orders response is malformed');
          return page.items;
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return [];
        throw error;
      }
    },
  });
  // 다시 읽지 못했으면 옛 숫자를 지금 숫자처럼 보이지 않는다
  const failed = loadFailed(query);
  const items = failed ? [] : (query.data ?? []);
  return {
    failed,
    of: (skuId: string) => items.find((item) => item.skuId === skuId) ?? null,
  };
}
