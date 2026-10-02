import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { OutboundBatchSummary } from './types';
import { fetchBatchWorkItems, type BatchWorkItem } from './waybillLabel';

/** GET /outbound-batches/:id/work-items — 스테이션 상태바의 배치 진행·F2 건수. 출고 뒤 무효화된다(mutations.ts) */
export function useBatchWorkItems(batchId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['batch-work-items', batchId],
    enabled: batchId !== null,
    queryFn: () => fetchBatchWorkItems(api, batchId ?? ''),
  });
}

/** «B-1002 13/40»(스펙 §5.5) — 출고된 박스 / 빠진 박스를 뺀 전체 */
export function batchProgressOf(
  batchNumber: string,
  items: readonly BatchWorkItem[]
): { code: string; done: number; total: number } {
  const live = items.filter((item) => item.status !== 'excluded');
  return { code: batchNumber, done: live.filter((item) => item.status === 'completed').length, total: live.length };
}

export interface BoxCounts {
  done: number;
  working: number;
  waiting: number;
  withdrawing: number;
}

/** 작업 중으로 세는 작업 항목 상태 — 결품 처리 중(short_pick_recovery)도 손이 닿은 박스다 */
const WORKING_STATUSES: ReadonlySet<string> = new Set(['picking', 'ready_to_pack', 'packing', 'short_pick_recovery']);

/** 배치 현황의 «완료 · 검수 중 · 대기 · 빠지는 중»(목업 ⑤). 빠진 박스(excluded)는 세지 않는다 */
export function boxCountsOf(items: readonly BatchWorkItem[]): BoxCounts {
  const counts: BoxCounts = { done: 0, working: 0, waiting: 0, withdrawing: 0 };
  for (const item of items) {
    if (item.status === 'completed') counts.done += 1;
    else if (item.status === 'withdrawing') counts.withdrawing += 1;
    else if (item.status === 'queued') counts.waiting += 1;
    else if (WORKING_STATUSES.has(item.status)) counts.working += 1;
  }
  return counts;
}

/** 진행 중(picking) 먼저, 시작 전(created) 다음. 두 조회 사이에 상태가 바뀐 배치는 한 번만(OutboundQueueScreen 과 같은 규칙) */
export function mergeBatches(
  picking: readonly OutboundBatchSummary[] | undefined,
  created: readonly OutboundBatchSummary[] | undefined
): OutboundBatchSummary[] {
  const seen = new Set<string>();
  return [...(picking ?? []), ...(created ?? [])].filter((batch) => {
    if (seen.has(batch.id)) return false;
    seen.add(batch.id);
    return true;
  });
}
