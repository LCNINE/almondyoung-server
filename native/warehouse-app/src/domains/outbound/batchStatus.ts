import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { OutboundBatchSummary } from './types';
import { fetchBatchWorkItems, type BatchLabelState, type BatchWorkItem } from './waybillLabel';

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

export interface BoxRow {
  shipmentId: string;
  trackingNo: string;
  recipient: string;
  status: string;
  /** alert = 송장 손볼 것, warn = 빠지는 중·결품 처리, work = 검수 중, idle = 대기 */
  tone: 'alert' | 'warn' | 'work' | 'idle';
}

const IN_WORK_STATUSES: ReadonlySet<string> = new Set(['picking', 'ready_to_pack', 'packing']);

/** 배치 현황 박스 한 줄(스펙 §8 F2, 목업 ⑤). 송장번호가 없으면(옛 core) null — 현장이 읽을 수 없는 id 를 그리지 않는다 */
export function boxRowOf(state: BatchLabelState): BoxRow | null {
  if (!state.trackingNo) return null;
  const base = { shipmentId: state.shipmentId, trackingNo: state.trackingNo, recipient: state.recipientMasked ?? '' };
  if (state.state === 'withdrawing' || state.workItemStatus === 'withdrawing') return { ...base, status: '빠지는 중', tone: 'warn' };
  if (state.state === 'never_printed') return { ...base, status: '미출력', tone: 'alert' };
  if (state.state === 'reprint_required') return { ...base, status: '재출력', tone: 'alert' };
  if (state.state === 'unavailable') return { ...base, status: '송장 확인', tone: 'alert' };
  if (state.workItemStatus === 'short_pick_recovery') return { ...base, status: '결품 처리 중', tone: 'warn' };
  if (state.workItemStatus && IN_WORK_STATUSES.has(state.workItemStatus)) return { ...base, status: '검수 중', tone: 'work' };
  return { ...base, status: '대기', tone: 'idle' };
}

const TONE_ORDER: Record<BoxRow['tone'], number> = { alert: 0, warn: 1, work: 2, idle: 3 };

/** 손이 가야 하는 박스가 위로 — 같은 무리 안에서는 송장번호 순 */
export function sortBoxRows(rows: readonly BoxRow[]): BoxRow[] {
  return [...rows].sort(
    (a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || (a.trackingNo < b.trackingNo ? -1 : a.trackingNo > b.trackingNo ? 1 : 0)
  );
}
