'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { customerReturnApi } from '@/lib/api/domains/customer-returns';
import type { CustomerReturnListQuery } from '@/lib/types/dto/customer-returns';
import { customerReturnQueryKeys } from './query-keys';

export const useCustomerReturns = (query: CustomerReturnListQuery, options: { enabled?: boolean } = {}) =>
  useQuery({
    enabled: options.enabled ?? true,
    queryKey: customerReturnQueryKeys.list(query),
    queryFn: () => customerReturnApi.list(query),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });

export const useCustomerReturn = (id: string | null) =>
  useQuery({
    enabled: !!id,
    queryKey: customerReturnQueryKeys.detail(id ?? ''),
    queryFn: () => customerReturnApi.get(id as string),
  });

/** 선환불 기본값·보류 차감 여지 — 금액 판단이라 열 때마다 새로 읽는다 */
export const useReturnSettlementPreview = (
  orderId: string,
  returnId: string,
  options: { enabled: boolean }
) =>
  useQuery({
    enabled: options.enabled && !!orderId && !!returnId,
    queryKey: customerReturnQueryKeys.preview(orderId, returnId),
    queryFn: () => customerReturnApi.settlementPreview(orderId, returnId),
    staleTime: 0,
    gcTime: 0,
  });

export const useOrderReturnable = (orderId: string | null) =>
  useQuery({
    enabled: !!orderId,
    queryKey: customerReturnQueryKeys.returnable(orderId ?? ''),
    queryFn: () => customerReturnApi.returnable(orderId as string),
    staleTime: 0,
  });
