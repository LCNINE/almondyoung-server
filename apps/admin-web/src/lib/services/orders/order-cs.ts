'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { orders } from '@/lib/api/domains';
import {
  orderCsClient,
  type CreateOrderContactRequest,
} from '@/lib/api/domains/orders/order-cs.client';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

export const orderCsKeys = {
  // 상자·재고를 바꾸는 동작들이 이미 무효화하는 앞머리를 쓴다
  context: (id: string) => ['order-progress', 'cs-context', id] as const,
  contacts: (id: string) => ['order-contacts', id] as const,
  // /cs 주문조회와 같은 키 — 같은 조회다
  order: (id: string) => ['cs', 'sales-order', id] as const,
};

export function useOrderCsContext(salesOrderId: string) {
  return useQuery({
    queryKey: orderCsKeys.context(salesOrderId),
    queryFn: () => orderCsClient.context(salesOrderId),
    refetchInterval: 60_000,
  });
}

/** 다른 사람이 방금 남긴 연락이 보이도록 펼쳐 둔 동안 자주 읽는다. */
export function useOrderContacts(salesOrderId: string) {
  return useQuery({
    queryKey: orderCsKeys.contacts(salesOrderId),
    queryFn: () => orderCsClient.contacts(salesOrderId),
    refetchInterval: 15_000,
  });
}

export function useCsSalesOrder(salesOrderId: string, enabled: boolean) {
  return useQuery({
    queryKey: orderCsKeys.order(salesOrderId),
    queryFn: () => orders.salesOrders.getSalesOrder(salesOrderId),
    enabled,
  });
}

export const useCreateOrderContact = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateOrderContactRequest) =>
      orderCsClient.createContact(data),
    onSuccess: (_, data) => {
      void queryClient.invalidateQueries({
        queryKey: orderCsKeys.contacts(data.salesOrderId),
      });
      void queryClient.invalidateQueries({
        queryKey: ['order-progress', 'orders'],
      });
    },
  });
};
useCreateOrderContact.permission = [
  'cs.inquiry.write',
] as const satisfies PermissionRequirement;
