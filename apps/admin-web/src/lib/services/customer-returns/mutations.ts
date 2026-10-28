'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customerReturnApi } from '@/lib/api/domains/customer-returns';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';
import type {
  CloseCustomerReturnMissingBody,
  RequestCustomerReturnPrepayBody,
  RequestOrderReturnBody,
  RestartCustomerReturnBody,
  SettleHeldCustomerReturnBody,
} from '@/lib/types/dto/customer-returns';
import { customerReturnQueryKeys } from './query-keys';

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: customerReturnQueryKeys.all });
}

/** Medusa — 접수. core 목록엔 폴링(≤ 5분) 뒤에 나타난다 */
export const useRequestCustomerReturn = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ orderId, body }: { orderId: string; body: RequestOrderReturnBody }) =>
      customerReturnApi.request(orderId, body),
    onSuccess: invalidate,
  });
};
useRequestCustomerReturn.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

/** Medusa — 도착 전 취소 */
export const useCancelCustomerReturn = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ orderId, returnId }: { orderId: string; returnId: string }) =>
      customerReturnApi.cancel(orderId, returnId),
    onSuccess: invalidate,
  });
};
useCancelCustomerReturn.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

export const useCloseCustomerReturnMissing = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CloseCustomerReturnMissingBody }) =>
      customerReturnApi.closeMissing(id, body),
    onSuccess: invalidate,
  });
};
useCloseCustomerReturnMissing.permission = ['order.claim.write'] as const satisfies PermissionRequirement;

export const useSettleHeldCustomerReturn = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SettleHeldCustomerReturnBody }) =>
      customerReturnApi.settleHeld(id, body),
    onSuccess: invalidate,
  });
};
useSettleHeldCustomerReturn.permission = ['payment.refund.execute'] as const satisfies PermissionRequirement;

export const useRequestCustomerReturnPrepay = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RequestCustomerReturnPrepayBody }) =>
      customerReturnApi.requestPrepay(id, body),
    onSuccess: invalidate,
  });
};
useRequestCustomerReturnPrepay.permission = ['payment.refund.execute'] as const satisfies PermissionRequirement;

export const useRestartCustomerReturn = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (v: {
      id: string;
      target: 'settlement' | 'prepayment';
      kind: 'retry' | 'manual';
      body?: RestartCustomerReturnBody;
    }) => customerReturnApi.restart(v.id, v.target, v.kind, v.body),
    onSuccess: invalidate,
  });
};
useRestartCustomerReturn.permission = ['payment.refund.execute'] as const satisfies PermissionRequirement;

export const useRetryCustomerReturnPickup = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => customerReturnApi.retryPickup(id),
    onSuccess: invalidate,
  });
};
useRetryCustomerReturnPickup.permission = ['order.claim.write'] as const satisfies PermissionRequirement;
