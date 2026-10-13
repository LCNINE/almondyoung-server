'use client';

import { businessLicensesApi } from '@/lib/api/domains/business-licenses';
import { BusinessLicenseUpdateDto } from '@/lib/types/dto/business-licenses';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { businessLicensesQueryKeys } from './query-keys';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

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
useUpdateBusinessLicense.permission = ['customer.business_verification.review'] as const satisfies PermissionRequirement;

export const useDeleteBusinessLicense = (id: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => businessLicensesApi.deleteBusinessLicense(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: businessLicensesQueryKeys.all });
    },
  });
};
useDeleteBusinessLicense.permission = ['customer.account.archive'] as const satisfies PermissionRequirement;
