import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type {
  CancelInboundInput,
  PutawayInput,
  ReceiveFromPlanInput,
  ReceiveFromPlanResult,
  SimpleInboundInput,
  SimpleInboundResult,
} from './types';

/**
 * 네 뮤테이션 모두 원장을 움직인다. 예정 잔여·로케이션 내용물·SKU 재고가 전부
 * 어긋나므로 한 곳에 묶어 부른다.
 */
function invalidateAfterLedgerWrite(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['inbound-pending'] });
  void qc.invalidateQueries({ queryKey: ['location-contents'] });
  void qc.invalidateQueries({ queryKey: ['sku-warehouse-stock'] });
  void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
}

/**
 * POST /inbound/plans/receive — 예정 아이템 기반 실입고.
 * 서버는 예정 초과를 막지 않는다(경고는 화면 책임). 로케이션을 안 넘기면
 * 입고기본존으로 들어가고, 목적지는 이어지는 putaway 가 정한다.
 *
 * onSettled 인 이유: 서버가 커밋한 뒤 응답만 유실되면 onSuccess 는 영영 안
 * 불린다. 그 상태로 예정 목록에 돌아오면 이미 입고된 수량이 잔여로 남아 보이고
 * 작업자가 한 번 더 찍는다.
 */
export function useReceiveFromPlan() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReceiveFromPlanInput) =>
      api.request<ReceiveFromPlanResult>({
        method: 'POST',
        path: '/inbound/plans/receive',
        body: input,
        idempotencyKey: input.idempotencyKey,
      }),
    onSettled: () => invalidateAfterLedgerWrite(qc),
  });
}

/** POST /inbound/simple — 다건 즉시 입고. 로케이션은 항상 입고기본존이다. */
export function useSimpleInbound() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SimpleInboundInput) =>
      api.request<SimpleInboundResult>({
        method: 'POST',
        path: '/inbound/simple',
        body: input,
        idempotencyKey: input.idempotencyKey,
      }),
    onSettled: () => invalidateAfterLedgerWrite(qc),
  });
}

/** POST /inbound/putaway — 입고기본존에서 목적지로 즉시 이동. lineId 기준. */
export function usePutaway() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PutawayInput) =>
      api.request<{ success: boolean }>({
        method: 'POST',
        path: '/inbound/putaway',
        body: input,
        idempotencyKey: input.idempotencyKey,
      }),
    onSettled: () => invalidateAfterLedgerWrite(qc),
  });
}

/**
 * POST /inbound/cancel — 직전 입고 되돌리기.
 * 서버 제약: 전량만·적치 전에만·당일(Asia/Seoul)만. 화면은 이 셋을 만족하는
 * 순간에만 버튼을 노출한다.
 */
export function useCancelInbound() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CancelInboundInput) =>
      api.request<{ success: boolean }>({
        method: 'POST',
        path: '/inbound/cancel',
        body: input,
        idempotencyKey: input.idempotencyKey,
      }),
    onSettled: () => invalidateAfterLedgerWrite(qc),
  });
}
