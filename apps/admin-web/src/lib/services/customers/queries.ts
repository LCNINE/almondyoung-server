// src/lib/services/customers/queries.ts
'use client';

import { customerApi, CustomerListQuery } from '@/lib/api/domains/customer';
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

// 고객 목록 조회 (페이지네이션 지원)
export const useCustomersWithPagination = (query: CustomerListQuery) => {
  return useQuery({
    queryKey: customerQueryKeys.list(query),
    queryFn: () => customerApi.getCustomersWithPagination(query),
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

// 특정 고객의 사업자 등록 정보 단건 조회 (없으면 null)
export const useBusinessLicenseByUserId = (userId: string) => {
  return useQuery({
    queryKey: customerQueryKeys.businessLicenseByUserId(userId),
    queryFn: () => customerApi.getBusinessLicenseByUserId(userId),
    enabled: !!userId,
  });
};
