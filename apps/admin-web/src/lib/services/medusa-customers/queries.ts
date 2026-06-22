// src/lib/services/medusa-customers/queries.ts
'use client';

import { medusaCustomerApi, medusaOrderApi } from '@/lib/api/domains/medusa';
import type {
  MedusaCustomerListQuery,
  MedusaOrderListQuery,
} from '@/lib/types/dto/medusa';
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

// Medusa 고객 ID로 주문 목록 조회 (최신순)
export const useMedusaOrdersByCustomerId = (
  customerId: string | undefined,
  query: Omit<MedusaOrderListQuery, 'customer_id'> = {}
) => {
  return useQuery({
    queryKey: medusaCustomerQueryKeys.orders(customerId ?? '', query),
    queryFn: () => medusaOrderApi.getOrdersByCustomerId(customerId!, query),
    enabled: !!customerId,
  });
};

// Medusa 주문 단건 상세 조회
export const useMedusaOrderById = (orderId: string | undefined) => {
  return useQuery({
    queryKey: medusaCustomerQueryKeys.order(orderId ?? ''),
    queryFn: () => medusaOrderApi.getOrderById(orderId!),
    enabled: !!orderId,
  });
};

// Medusa 고객 장바구니 조회
export const useMedusaCustomerCart = (customerId: string | undefined) => {
  return useQuery({
    queryKey: medusaCustomerQueryKeys.cart(customerId ?? ''),
    queryFn: () => medusaCustomerApi.getCustomerCart(customerId!),
    enabled: !!customerId,
  });
};
