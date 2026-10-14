'use client';

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { lineCompositionClient } from '@/lib/api/domains/orders/line-composition.client';
import type { PutLineCompositionRequest } from '@/lib/types/dto/line-composition';
import { matchingQueryKeys } from '@/lib/services/matching/query-keys';
import { orderQueryKeys } from './query-keys';

// 라인 구성이 바뀌면 FO 상세(박스·항목), 매칭체크 목록(개별 지정·해결 여부), 주문 목록(매칭 배지)이 같이 바뀐다
function invalidateCompositionReaders(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillments });
  queryClient.invalidateQueries({ queryKey: matchingQueryKeys.orderLineLists() });
  queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
}

export const useAssignLineComposition = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      salesOrderId: string;
      salesOrderLineId: string;
      body: PutLineCompositionRequest;
    }) => lineCompositionClient.assign(input.salesOrderId, input.salesOrderLineId, input.body),
    onSuccess: () => invalidateCompositionReaders(queryClient),
  });
};

export const useApplyToExistingLines = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variantId: string) => lineCompositionClient.applyToExistingLines(variantId),
    onSuccess: () => invalidateCompositionReaders(queryClient),
  });
};
