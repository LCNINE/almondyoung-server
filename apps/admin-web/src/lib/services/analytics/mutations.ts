'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { analyticsApi } from '@/lib/api/domains/analytics';
import { analyticsQueryKeys } from './query-keys';

/**
 * 고정비를 바꾸면 손익·손익분기가 같이 바뀐다 — profit 조회까지 무효화해야
 * 설정 직후 화면의 판정이 옛 값으로 남지 않는다.
 */
function invalidateOperatingCost(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: analyticsQueryKeys.operatingCosts() });
  queryClient.invalidateQueries({ queryKey: [...analyticsQueryKeys.all, 'profit'] });
}

export const useCreateOperatingCost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { monthlyFixedCost: number; effectiveFrom: string; memo?: string }) =>
      analyticsApi.createOperatingCost(payload),
    onSuccess: () => invalidateOperatingCost(queryClient),
  });
};

export const useDeleteOperatingCost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => analyticsApi.deleteOperatingCost(id),
    onSuccess: () => invalidateOperatingCost(queryClient),
  });
};
