'use client';

import { businessLicensesApi } from '@/lib/api/domains/business-licenses';
import { BusinessLicenseListQuery } from '@/lib/types/dto/business-licenses';
import { keepPreviousData, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { businessLicensesQueryKeys } from './query-keys';

export const useBusinessLicenses = (query: BusinessLicenseListQuery, options: { enabled?: boolean } = {}) => {
  return useQuery({
    enabled: options.enabled ?? true,
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

export const useDailyBusinessLicenseCounts = (from: string, to: string, options: { enabled?: boolean } = {}) => {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: [...businessLicensesQueryKeys.all, 'daily', { from, to }] as const,
    queryFn: () => businessLicensesApi.getDailyCounts(from, to),
    staleTime: 60 * 1000,
  });
};
