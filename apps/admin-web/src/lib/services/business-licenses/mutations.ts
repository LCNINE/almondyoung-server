'use client';

import { businessLicensesApi } from '@/lib/api/domains/business-licenses';
import { BusinessLicenseUpdateDto } from '@/lib/types/dto/business-licenses';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { businessLicensesQueryKeys } from './query-keys';

export const useUpdateBusinessLicense = (businessId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: BusinessLicenseUpdateDto) =>
      businessLicensesApi.updateBusinessLicense(businessId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: businessLicensesQueryKeys.all });
    },
  });
};

export const useDeleteBusinessLicense = (id: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => businessLicensesApi.deleteBusinessLicense(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: businessLicensesQueryKeys.all });
    },
  });
};
