// src/lib/services/customers/queries.ts
'use client';

import { customerApi } from '@/lib/api/domains';
import { CustomerBusinessLicenseQueryDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { customerQueryKeys } from './query-keys';

// 소비자 관련 쿼리
export const useCustomers = () => {
  return useQuery({
    queryKey: customerQueryKeys.all,
    queryFn: () => customerApi.getCustomers(),
  });
};

export const useCustomerById = (id: string) => {
  return useQuery({
    queryKey: customerQueryKeys.detailById(id),
    queryFn: () => customerApi.getCustomerById(id),
    enabled: !!id,
  });
};

export const useCustomerByEmail = (email: string) => {
  return useQuery({
    queryKey: customerQueryKeys.detailByEmail(email),
    queryFn: () => customerApi.findCustomerByEmail(email),
    enabled: !!email,
  });
};

// 고객 동의 관련 쿼리
export const useConsents = (query: {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'username' | 'email' | 'lastActivityAt';
  sortOrder?: 'asc' | 'desc';
}) => {
  return useQuery({
    queryKey: customerQueryKeys.consents(),
    queryFn: () => customerApi.getCustomerConsents(query),
  });
};

export const useConsent = (id: string) => {
  return useQuery({
    queryKey: customerQueryKeys.consent(id),
    queryFn: () => customerApi.getCustomerById(id),
    enabled: !!id,
  });
};

// 사업자등록증 관련 쿼리
export const useBusinessLicenses = (query: CustomerBusinessLicenseQueryDto) => {
  return useQuery({
    queryKey: customerQueryKeys.businessLicenses(),
    queryFn: () => customerApi.getBusinessLicenses(query),
  });
};

// 쇼핑몰 정보 관련 쿼리
export const useShopInfoByUserId = (userId: string) => {
  return useQuery({
    queryKey: customerQueryKeys.shop(userId),
    queryFn: () => customerApi.getShopByUserId(userId),
    enabled: !!userId,
  });
};
