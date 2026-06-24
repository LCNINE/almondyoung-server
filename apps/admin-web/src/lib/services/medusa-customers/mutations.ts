// src/lib/services/medusa-customers/mutations.ts
// Medusa 고객 배송지(주소) 뮤테이션
'use client';

import {
  MedusaAddressPayload,
  medusaCustomerApi,
} from '@/lib/api/domains/medusa';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { medusaCustomerQueryKeys } from './query-keys';

// 배송지 추가
export const useCreateMedusaAddress = (customerId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: MedusaAddressPayload) =>
      medusaCustomerApi.createAddress(customerId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: medusaCustomerQueryKeys.detail(customerId),
      });
    },
  });
};

// 배송지 수정
export const useUpdateMedusaAddress = (customerId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      addressId,
      payload,
    }: {
      addressId: string;
      payload: MedusaAddressPayload;
    }) => medusaCustomerApi.updateAddress(customerId, addressId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: medusaCustomerQueryKeys.detail(customerId),
      });
    },
  });
};

// 배송지 삭제
export const useDeleteMedusaAddress = (customerId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (addressId: string) =>
      medusaCustomerApi.deleteAddress(customerId, addressId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: medusaCustomerQueryKeys.detail(customerId),
      });
    },
  });
};
