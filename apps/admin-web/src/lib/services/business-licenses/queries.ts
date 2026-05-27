'use client';

import { businessLicensesApi } from '@/lib/api/domains/business-licenses';
import { BusinessLicenseListQuery } from '@/lib/types/dto/business-licenses';
import { keepPreviousData, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { businessLicensesQueryKeys } from './query-keys';

export const useBusinessLicenses = (query: BusinessLicenseListQuery) => {
  return useQuery({
    queryKey: businessLicensesQueryKeys.list(query),
    queryFn: () => businessLicensesApi.getBusinessLicenses(query),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
};

export const useBusinessLicense = (id: string) => {
  return useSuspenseQuery({
    queryKey: businessLicensesQueryKeys.detail(id),
    queryFn: () => businessLicensesApi.getBusinessLicense(id),
    staleTime: 30 * 1000,
  });
};
