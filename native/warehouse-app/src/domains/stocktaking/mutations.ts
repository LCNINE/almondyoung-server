import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type {
  GenerateAdjustmentsResult,
  ScanLocationResult,
  ScanProductResult,
  StocktakingSession,
} from './types';

function invalidateSession(qc: QueryClient, sessionId: string) {
  void qc.invalidateQueries({ queryKey: ['stocktaking-session', sessionId] });
}

/**
 * 카운트에 영향을 주는 모든 뮤테이션(위치 스캔의 라인 upsert 포함) 뒤에 부른다.
 * VarianceReviewScreen 의 완료 게이트가 신선한 차이 목록에 기대므로, 이 무효화를
 * 빠뜨리면 스테일 캐시가 실제로는 존재하는 차이를 "없음"으로 보여줄 수 있다.
 */
function invalidateVariances(qc: QueryClient, sessionId: string) {
  void qc.invalidateQueries({ queryKey: ['stocktaking-variances', sessionId] });
}

function invalidateList(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['stocktaking-sessions'] });
}

export interface CreateSessionInput {
  warehouseId: string;
  sessionName: string;
  notes?: string;
}

/** POST /stocktaking/sessions */
export function useCreateSession() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSessionInput) =>
      api.request<StocktakingSession>({ method: 'POST', path: '/stocktaking/sessions', body: input }),
    onSuccess: () => invalidateList(qc),
  });
}

/** POST /stocktaking/sessions/:id/start */
export function useStartSession() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.request<unknown>({ method: 'POST', path: `/stocktaking/sessions/${sessionId}/start` }),
    onSuccess: (_data, sessionId) => {
      invalidateList(qc);
      invalidateSession(qc, sessionId);
    },
  });
}

/** POST /stocktaking/sessions/:id/cancel */
export function useCancelSession() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.request<unknown>({ method: 'POST', path: `/stocktaking/sessions/${sessionId}/cancel` }),
    onSuccess: (_data, sessionId) => {
      invalidateList(qc);
      invalidateSession(qc, sessionId);
    },
  });
}

export interface ScanLocationInput {
  sessionId: string;
  locationBarcode: string;
}

/** POST /stocktaking/scan-location — 라인을 upsert 하고 그 위치의 전체 라인을 돌려준다. */
export function useScanLocation() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ScanLocationInput) =>
      api.request<ScanLocationResult>({
        method: 'POST',
        path: '/stocktaking/scan-location',
        body: input,
      }),
    onSuccess: (_data, input) => {
      invalidateSession(qc, input.sessionId);
      invalidateVariances(qc, input.sessionId);
    },
  });
}

export interface ScanProductInput {
  sessionId: string;
  locationId: string;
  productBarcode: string;
  /** 서버는 이 값을 기존 카운트에 **더한다**. */
  quantity: number;
}

/** POST /stocktaking/scan-product — 증가 연산. 응답 countedQuantity 는 갱신 후 절대값. */
export function useScanProduct() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ScanProductInput) =>
      api.request<ScanProductResult>({
        method: 'POST',
        path: '/stocktaking/scan-product',
        body: input,
      }),
    onSuccess: (_data, input) => {
      invalidateSession(qc, input.sessionId);
      invalidateVariances(qc, input.sessionId);
    },
  });
}

export interface UpdateCountInput {
  sessionId: string;
  lineId: string;
  /** 절대값 세팅(정정용). scan-product 의 증가 연산과 다르다. */
  countedQuantity: number;
  notes?: string;
}

/** PUT /stocktaking/lines/:lineId/count */
export function useUpdateCount() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCountInput) =>
      api.request<ScanProductResult>({
        method: 'PUT',
        path: `/stocktaking/lines/${input.lineId}/count`,
        body: { countedQuantity: input.countedQuantity, notes: input.notes },
      }),
    onSuccess: (_data, input) => {
      invalidateSession(qc, input.sessionId);
      invalidateVariances(qc, input.sessionId);
    },
  });
}

/** POST /stocktaking/sessions/:id/generate-adjustments — dry-run 미리보기(영속 없음). */
export function useGenerateAdjustments() {
  const api = useApiClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.request<GenerateAdjustmentsResult>({
        method: 'POST',
        path: `/stocktaking/sessions/${sessionId}/generate-adjustments`,
        body: {},
      }),
  });
}

/** POST /stocktaking/sessions/:id/complete — 원장에 조정을 원자 적용하고 종결한다. */
export function useCompleteSession() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.request<unknown>({ method: 'POST', path: `/stocktaking/sessions/${sessionId}/complete` }),
    onSuccess: (_data, sessionId) => {
      invalidateList(qc);
      invalidateSession(qc, sessionId);
      void qc.invalidateQueries({ queryKey: ['stocktaking-variances', sessionId] });
      // 원장이 실제로 움직였으므로 재고 화면도 새로 읽어야 한다.
      void qc.invalidateQueries({ queryKey: ['sku-warehouse-stock'] });
      void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
    },
  });
}
