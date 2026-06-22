// src/lib/services/medusa-customers/queries.ts
'use client';

import {
  medusaCustomerApi,
  MedusaCustomerListQuery,
} from '@/lib/api/domains/medusa';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { medusaCustomerQueryKeys } from './query-keys';

// Medusa 고객 목록 조회
export const useMedusaCustomers = (query: MedusaCustomerListQuery = {}) => {
  return useQuery({
    queryKey: medusaCustomerQueryKeys.list(query),
    queryFn: () => medusaCustomerApi.getCustomers(query),
  });
};

// Medusa 고객 상세 조회 (주소 포함)
export const useMedusaCustomerById = (id: string) => {
  return useSuspenseQuery({
    queryKey: medusaCustomerQueryKeys.detail(id),
    queryFn: () => medusaCustomerApi.getCustomerById(id),
  });
};

// 이메일로 Medusa 고객 검색
export const useMedusaCustomerByEmail = (email: string) => {
  return useQuery({
    queryKey: medusaCustomerQueryKeys.byEmail(email),
    queryFn: () => medusaCustomerApi.getCustomerByEmail(email),
    enabled: !!email,
  });
};

export const useMedusaCustomerByAlmondUserId = (
  almondUserId: string | null | undefined
) => {
  return useQuery({
    queryKey: medusaCustomerQueryKeys.byAlmondUserId(almondUserId ?? ''),
    queryFn: () => medusaCustomerApi.getCustomerByAlmondUserId(almondUserId!),
    enabled: !!almondUserId,
  });
};
