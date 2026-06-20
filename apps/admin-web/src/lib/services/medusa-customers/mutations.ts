'use client';

import {
  medusaCustomerApi,
  type MedusaCustomerAddressPayload,
} from '@/lib/api/domains/medusa';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { medusaCustomerQueryKeys } from './query-keys';

export const useCreateMedusaCustomerAddress = (customerId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: MedusaCustomerAddressPayload) =>
      medusaCustomerApi.createCustomerAddress(customerId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: medusaCustomerQueryKeys.detail(customerId),
      });
      void queryClient.invalidateQueries({
        queryKey: medusaCustomerQueryKeys.all,
      });
    },
  });
};
