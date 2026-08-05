// src/lib/services/products/form-export.ts
// 선택 상품 프리필 양식(대량등록 재출력) 요청·폴링 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { products } from '@/lib/api/domains';
import { formExportListRefetchInterval } from './form-export-model';
import { productQueryKeys } from './query-keys';

export function useRequestFormExport() {
  return useMutation({
    mutationFn: (masterIds: string[]) => products.formExport.request(masterIds),
  });
}

export function useFormExportList(page: number, limit: number) {
  return useQuery({
    queryKey: productQueryKeys.formExportList(page, limit),
    queryFn: () => products.formExport.list(page, limit),
    refetchInterval: (query) => formExportListRefetchInterval(query.state.data),
  });
}

export function useRetryFormExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (exportId: string) => products.formExport.retry(exportId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productQueryKeys.formExports });
    },
  });
}
