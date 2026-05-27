import { BusinessLicenseListQuery } from '@/lib/types/dto/business-licenses';

export const businessLicensesQueryKeys = {
  all: ['business-licenses'] as const,
  list: (query: BusinessLicenseListQuery) =>
    [...businessLicensesQueryKeys.all, 'list', query] as const,
  detail: (id: string) =>
    [...businessLicensesQueryKeys.all, 'detail', id] as const,
} as const;
