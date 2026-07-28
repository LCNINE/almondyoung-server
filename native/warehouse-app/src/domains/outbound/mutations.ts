import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { ForceSimpleOutboundInput, SimpleOutboundScanInput, SimpleOutboundState } from './types';

/**
 * POST /shipments/:id/simple-outbound-scans
 *
 * 스캔 한 번이 서버 한 트랜잭션(피킹 → 전량이면 완료·검수·출고)이다. 앱은
 * 응답의 라인 진행을 그대로 그리면 되고 중간 상태를 스스로 계산하지 않는다.
 */
export function useSimpleOutboundScan() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shipmentId, barcode, quantity, idempotencyKey }: SimpleOutboundScanInput) =>
      api.request<SimpleOutboundState>({
        method: 'POST',
        path: `/shipments/${shipmentId}/simple-outbound-scans`,
        body: { barcode, quantity },
        idempotencyKey,
      }),
    // onSettled: 서버가 커밋한 뒤 응답만 유실돼도 화면은 갱신돼야 한다 —
    // onSuccess 라면 그 경우 영영 안 불려서 잔량이 낡은 채로 남는다.
    // 출고는 배치 잔량과 재고를 동시에 움직인다 — 한쪽만 갱신하면 두 화면이
    // 서로 다른 사실을 말한다.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['outbound-batches'] });
      void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
    },
  });
}

/** POST /shipments/:id/simple-outbound-forces — 미스캔 수량을 채우고 강제 출고. */
export function useForceSimpleOutbound() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shipmentId, reason, idempotencyKey }: ForceSimpleOutboundInput) =>
      api.request<SimpleOutboundState>({
        method: 'POST',
        path: `/shipments/${shipmentId}/simple-outbound-forces`,
        body: { reason },
        idempotencyKey,
      }),
    // 위와 같은 이유: 응답 유실이어도 배치/재고 화면은 새로고침돼야 한다.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['outbound-batches'] });
      void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
    },
  });
}
