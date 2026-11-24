import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { ApiError } from '../../core/data/httpClient';
import { loadFailed } from '../../core/data/loadFailed';

/** 이번 입고가 완성시킨 상자. core `GET /ready-shipments` 의 한 줄. */
export interface ReadyShipment {
  shipmentId: string;
  status: 'draft' | 'planned';
  orderNos: string[];
  recipientMasked: string;
  skuCount: number;
  totalQty: number;
  readiness: 'ready' | 'putaway_required';
}

export const READY_SHIPMENTS_KEY = 'ready-shipments';

const MAX_RECEIPT_LINE_IDS = 100;

interface ReadyShipmentsPage {
  items: ReadyShipment[];
  waitingOnOtherSkus: number;
}

/**
 * GET /ready-shipments — 입고를 거들 뿐이라 실패해도 작업을 막지 않는다.
 * 이 경로를 모르는 옛 서버(404)에서는 아무것도 보이지 않는다.
 */
export function useReadyShipments(
  warehouseId: string | null,
  receiptLineIds: readonly string[]
) {
  const api = useApiClient();
  const ids = [...new Set(receiptLineIds)].sort();
  const query = useQuery({
    queryKey: [READY_SHIPMENTS_KEY, warehouseId, ids.join(',')],
    enabled: warehouseId !== null && ids.length > 0,
    refetchOnMount: 'always',
    // 입고 줄이 늘 때 이미 본 목록이 깜빡이지 않게 — 다른 창고 것은 쓰지 않는다
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === warehouseId ? previous : undefined,
    queryFn: async (): Promise<ReadyShipmentsPage> => {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += MAX_RECEIPT_LINE_IDS)
        chunks.push(ids.slice(i, i + MAX_RECEIPT_LINE_IDS));
      try {
        const pages = await Promise.all(
          chunks.map((chunk) =>
            api.request<ReadyShipmentsPage>({
              path: `/ready-shipments?${new URLSearchParams({
                warehouseId: warehouseId ?? '',
                receiptLineIds: chunk.join(','),
              }).toString()}`,
            })
          )
        );
        const merged: ReadyShipmentsPage = { items: [], waitingOnOtherSkus: 0 };
        for (const page of pages) {
          if (!Array.isArray(page?.items))
            throw new Error('ready shipments response is malformed');
          merged.items.push(...page.items);
          merged.waitingOnOtherSkus += page.waitingOnOtherSkus ?? 0;
        }
        return merged;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404)
          return { items: [], waitingOnOtherSkus: 0 };
        throw error;
      }
    },
  });
  // 다시 읽지 못했으면 옛 목록을 지금 목록처럼 보이지 않는다
  const failed = loadFailed(query);
  return {
    failed,
    items: failed ? [] : (query.data?.items ?? []),
    waitingOnOtherSkus: failed ? 0 : (query.data?.waitingOnOtherSkus ?? 0),
    refetch: () => void query.refetch(),
  };
}
