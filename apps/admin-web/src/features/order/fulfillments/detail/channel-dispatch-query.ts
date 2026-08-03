'use client';

import { useQueries } from '@tanstack/react-query';
import { fetchWithRefresh } from '@/lib/api/fetch-with-refresh';
import type { ShipmentAdminDetail } from '@/lib/types/dto/fulfillment';
import {
  buildChannelDispatchTargets,
  buildChannelDispatchViewModel,
  type ChannelDispatchOperation,
  type ChannelDispatchViewModel,
} from './channel-dispatch-model';

interface ChannelDispatchApiResponse {
  dispatchAttemptId: string;
  salesOrderId: string;
  operations: ChannelDispatchOperation[];
}

async function fetchChannelDispatch(
  dispatchAttemptId: string,
  salesOrderId: string
): Promise<ChannelDispatchApiResponse> {
  const response = await fetchWithRefresh(
    `/api/fulfillment/channel-dispatch/attempts/${encodeURIComponent(dispatchAttemptId)}/orders/${encodeURIComponent(salesOrderId)}`,
    { cache: 'no-store' }
  );
  if (!response.ok) throw new Error('Channel projection unavailable');
  return response.json() as Promise<ChannelDispatchApiResponse>;
}

export function useChannelDispatchViewModel(
  shipment: ShipmentAdminDetail
): ChannelDispatchViewModel {
  const targets = buildChannelDispatchTargets(shipment);
  const results = useQueries({
    queries: targets.map((target) => ({
      queryKey: [
        'fulfillment',
        'channel-dispatch',
        target.dispatchAttemptId,
        target.salesOrderId,
      ],
      queryFn: () =>
        fetchChannelDispatch(target.dispatchAttemptId, target.salesOrderId),
      staleTime: 5_000,
      refetchInterval: 5_000,
      retry: 1,
    })),
  });

  return buildChannelDispatchViewModel(
    targets.map((target, index) => ({
      target,
      availability: results[index]?.isError
        ? 'error'
        : results[index]?.isSuccess
          ? 'ready'
          : 'loading',
      operations: results[index]?.data?.operations ?? [],
    }))
  );
}
