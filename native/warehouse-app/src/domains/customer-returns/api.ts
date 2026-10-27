import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { ReceivingPage, ReturnView } from './types';

/** GET /admin/customer-return-receiving — 빈 문자열 필터는 쿼리스트링에서 뺀다. */
export function useReceivingReturns(
  warehouseId: string,
  filter: { q: string; barcode: string }
) {
  const api = useApiClient();
  return useQuery({
    queryKey: [
      'customer-return-receiving',
      warehouseId,
      filter.q,
      filter.barcode,
    ],
    enabled: warehouseId !== '',
    queryFn: () => {
      const qs = new URLSearchParams({ warehouseId });
      if (filter.q) qs.set('q', filter.q);
      if (filter.barcode) qs.set('barcode', filter.barcode);
      return api.request<ReceivingPage>({
        path: `/admin/customer-return-receiving?${qs.toString()}`,
      });
    },
  });
}

/** 창고용 읽기 라우트 — `/admin/customer-returns/:id` 는 order.claim.read 라 창고 작업자가 못 쓴다. */
export function fetchReturn(api: ApiClient, id: string): Promise<ReturnView> {
  return api.request<ReturnView>({
    path: `/admin/customer-return-receiving/${encodeURIComponent(id)}`,
  });
}

export function recordArrival(
  api: ApiClient,
  id: string,
  body: {
    warehouseId: string;
    items: Array<{ customerReturnItemId: string; quantity: number }>;
    idempotencyKey: string;
  }
): Promise<ReturnView> {
  return api.request<ReturnView>({
    method: 'POST',
    path: `/admin/customer-returns/${encodeURIComponent(id)}/arrivals`,
    body,
  });
}

export function recordInspection(
  api: ApiClient,
  id: string,
  body: {
    items: Array<{
      customerReturnItemId: string;
      accepted: number;
      rejected: number;
      held: number;
    }>;
  }
): Promise<ReturnView> {
  return api.request<ReturnView>({
    method: 'POST',
    path: `/admin/customer-returns/${encodeURIComponent(id)}/inspection`,
    body,
  });
}
