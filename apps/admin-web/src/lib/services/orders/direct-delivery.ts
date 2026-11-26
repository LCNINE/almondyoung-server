import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  directDeliveryClient,
  type DirectDeliveryReturnRequest,
  type DirectDeliveryTakeoverRequest,
  type DirectDeliveryDispatchRequest,
} from '@/lib/api/domains/orders/direct-delivery.client';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';
import { orderQueryKeys } from './query-keys';

// 출고 키 아래에 둔다 — 상자를 바꾸는 명령(되돌리기·나누기)이 이 목록도 다시 읽게 한다
const keys = {
  all: [...orderQueryKeys.fulfillments, 'direct-delivery'] as const,
  preview: (shipmentId: string) =>
    [...keys.all, 'preview', shipmentId] as const,
  awaiting: (warehouseId: string) =>
    [...keys.all, 'awaiting', warehouseId] as const,
};

/** 창을 열 때마다 새로 읽는다 — 그 사이 다른 사람이 상자를 바꿨을 수 있다 */
export function useDirectDeliveryPreview(shipmentId: string) {
  return useQuery({
    queryKey: keys.preview(shipmentId),
    queryFn: () => directDeliveryClient.preview(shipmentId),
    refetchOnMount: 'always',
    gcTime: 0,
  });
}

export function useDirectDeliveryAwaiting(warehouseId: string | null) {
  return useQuery({
    queryKey: keys.awaiting(warehouseId ?? ''),
    queryFn: () => directDeliveryClient.awaitingTracking(warehouseId ?? ''),
    enabled: !!warehouseId,
  });
}

// 맡기기·되돌리기는 상자를 새로 만들고 옛 상자를 대체한다 — 상자를 보이는 출고 화면을 다시 읽는다
const invalidateFulfillments = (
  queryClient: ReturnType<typeof useQueryClient>
) =>
  Promise.all(
    [
      orderQueryKeys.fulfillments,
      orderQueryKeys.outboundPreparation,
      ['direct-ship'] as const,
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey }))
  );

export const useDirectDeliveryTakeover = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: DirectDeliveryTakeoverRequest;
      idempotencyKey: string;
    }) => directDeliveryClient.takeover(shipmentId, data, idempotencyKey),
    onSettled: () => invalidateFulfillments(queryClient),
  });
};
useDirectDeliveryTakeover.permission = [
  'fulfillment.order.write',
] as const satisfies PermissionRequirement;

export const useDirectDeliveryDispatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: DirectDeliveryDispatchRequest;
      idempotencyKey: string;
    }) => directDeliveryClient.dispatch(shipmentId, data, idempotencyKey),
    onSettled: () => invalidateFulfillments(queryClient),
  });
};
useDirectDeliveryDispatch.permission = [
  'fulfillment.order.write',
] as const satisfies PermissionRequirement;

export const useDirectDeliveryReturn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: DirectDeliveryReturnRequest;
      idempotencyKey: string;
    }) =>
      directDeliveryClient.returnToWarehouse(shipmentId, data, idempotencyKey),
    onSettled: () => invalidateFulfillments(queryClient),
  });
};
useDirectDeliveryReturn.permission = [
  'fulfillment.order.write',
] as const satisfies PermissionRequirement;
