// src/lib/services/products/form-export.ts
// 선택 상품 프리필 양식(대량등록 재출력) 요청·폴링 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { products } from '@/lib/api/domains';
import type { FormExportStatus } from '@/lib/types/dto/form-export';
import { formExportListRefetchInterval } from './form-export-model';
import { productQueryKeys } from './query-keys';

/**
 * 데이터가 아직 없는 동안에도 계속 두드린다 — 첫 요청이 한 번 실패해도 화면이 얼지 않는다.
 * TanStack Query 는 에러 상태를 이 콜백에 넘기지 않으므로 판단 재료가 data 뿐이다.
 * data 를 undefined 로 두면(초기 로드 · 일시적 5xx) 인터벌이 걸리지 않아 화면이 마운트
 * 내내 멈춘 채로 남으므로, 값이 들어올 때까지는 진행 중으로 보고 계속 두드려야 한다.
 */
export function formExportRefetchInterval(
  data: FormExportStatus | undefined
): number | false {
  if (!data) return 2000;
  return data.status === 'queued' || data.status === 'running' ? 2000 : false;
}

/** 알 수 없는 상태(undefined)는 진행 중으로 본다 — 접수 직후 첫 응답 전에 화면이 굳지 않게. */
export function isFormExportRunning(
  status: FormExportStatus['status'] | undefined
): boolean {
  return status !== 'completed' && status !== 'failed';
}

export function useRequestFormExport() {
  return useMutation({
    mutationFn: (masterIds: string[]) => products.formExport.request(masterIds),
  });
}

export function useFormExportStatus(exportId: string | null) {
  return useQuery({
    queryKey: productQueryKeys.formExport(exportId ?? ''),
    // `enabled` 가 exportId !== null 일 때만 이 queryFn 을 부르지만, TS 는 같은 객체
    // 리터럴의 두 옵션 사이 관계를 좁혀주지 않는다. as 캐스팅 대신 가드로 좁힌다 —
    // 이 분기에 실제로 들어오면 enabled 배선이 깨진 것이므로 조용히 undefined 로
    // 넘기지 않고 바로 던진다.
    queryFn: () => {
      if (exportId === null) {
        throw new Error(
          'useFormExportStatus queryFn 은 exportId 가 있을 때만 호출돼야 한다(enabled 배선 확인)'
        );
      }
      return products.formExport.getStatus(exportId);
    },
    enabled: exportId !== null,
    refetchInterval: (query) => formExportRefetchInterval(query.state.data),
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
