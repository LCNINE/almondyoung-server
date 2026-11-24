import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  carrierTrackingClient,
  type ConfirmCarrierTrackingRequest,
} from '@/lib/api/domains/orders/carrier-tracking.client';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';
import { orderQueryKeys } from './query-keys';

// 출고 키 아래에 둔다 — 되돌리기처럼 상자를 바꾸는 명령이 이 목록도 다시 읽게 한다
const keys = {
  all: [...orderQueryKeys.fulfillments, 'carrier-tracking'] as const,
  summary: () => [...keys.all, 'summary'] as const,
  attention: () => [...keys.all, 'attention'] as const,
  shipment: (shipmentId: string) =>
    [...keys.all, 'shipment', shipmentId] as const,
};

export function useCarrierTrackingSummary(enabled: boolean) {
  return useQuery({
    queryKey: keys.summary(),
    queryFn: carrierTrackingClient.summary,
    enabled,
    refetchInterval: 5 * 60_000,
  });
}

export function useCarrierTrackingAttention(enabled = true) {
  return useQuery({
    queryKey: keys.attention(),
    queryFn: carrierTrackingClient.attention,
    enabled,
    refetchInterval: 60_000,
  });
}

export function useShipmentCarrierTracking(
  shipmentId: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: keys.shipment(shipmentId),
    queryFn: () => carrierTrackingClient.shipment(shipmentId),
    enabled,
  });
}

export const useRecheckCarrierTracking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dispatchAttemptId: string) =>
      carrierTrackingClient.recheck(dispatchAttemptId),
    // 새 스캔이 들어오면 상자 상태도 바뀐다
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillments }),
  });
};
useRecheckCarrierTracking.permission = [
  'fulfillment.warehouse.operate',
] as const satisfies PermissionRequirement;

export const useConfirmCarrierTracking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      dispatchAttemptId,
      data,
      idempotencyKey,
    }: {
      dispatchAttemptId: string;
      data: ConfirmCarrierTrackingRequest;
      idempotencyKey: string;
    }) =>
      carrierTrackingClient.confirm(dispatchAttemptId, data, idempotencyKey),
    // 거절(다른 사람이 먼저 기록·그 사이 풀림)이어도 지금 상태가 답이라 다시 읽는다
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.all }),
  });
};
useConfirmCarrierTracking.permission = [
  'fulfillment.warehouse.operate',
] as const satisfies PermissionRequirement;
