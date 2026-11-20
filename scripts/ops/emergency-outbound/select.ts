/**
 * 비상 출고 대상 고르기 (#1249, 스펙 «① 아침 — 2»). 순수 함수 — I/O 없음.
 */
import type { BatchListItem, PreparationShipment, WorkItem } from './core-api';

export type Route = 'location' | 'force';
export type Target =
  | { shipmentId: string; from: 'draft' }
  | { shipmentId: string; from: 'planned' }
  | { shipmentId: string; from: 'batch'; batchId: string; route: Route };
export interface Skipped {
  shipmentId: string;
  reason: string;
  orderNos?: string[];
}

export interface SelectInput {
  ready: PreparationShipment[];
  resume: PreparationShipment[];
  otherBuckets: { bucket: string; shipments: PreparationShipment[] }[];
  batches: { batch: BatchListItem; workItems: WorkItem[] }[];
  /** 이번 실행이 앞서 만든 배치 — 시작 전이어도 이어간다(prepare 가 시작한다). */
  ownBatchId?: string;
  /**
   * 같은 PC 의 아직 안 끝난 다른 비상 출고 실행(`.scratch/emergency-outbound/<다른 실행>/run.json`)이 가진 것 — id → 그 실행 id.
   * `batches` 는 그 실행이 만든 배치(안의 상자 전부), `shipments` 는 그 실행이 맡은 상자 전부.
   * 그 상자의 라벨·피킹 리스트·발송은 그 실행 몫이다 — 여기서 다시 집으면 라벨이 두 장, 피킹이 두 번 된다.
   * 배치에서 빠져 출고 준비 목록으로 돌아와도 마찬가지다(라벨은 이미 그 실행이 찍었다).
   */
  foreign?: { batches: ReadonlyMap<string, string>; shipments: ReadonlyMap<string, string> };
}

export function foreignReason(run: string): string {
  return `앞 실행 ${run} 의 상자 — 그 실행의 dispatch 로`;
}

const REASON_OTHER_METHOD = '다른 피킹 방식 배치에서 피킹 중';
const REASON_NOT_STARTED = '시작 전 배치 — 앱/화면에서 시작하거나 배치에서 뺀 뒤 다시';
const REASON_MERGEABLE = '합칠 수 있는 상자 — 비상 경로에서 뺌';
// core 출고 준비 조회는 partial·unavailable 상자에 reason 을 비워(null) 보낸다 — 버킷 뜻을 사람 말로 찍는다(2026-11-19 라이브 리허설)
const BUCKET_LABEL: Record<string, string> = {
  partial: '일부만 낼 수 있는 상자(재고가 모자란 줄이 있다)',
  unavailable: '재고 없음',
  needs_info: '정보 부족',
};
const bucketReason = (bucket: string, reason: string | null): string => {
  const label = BUCKET_LABEL[bucket] ?? bucket;
  return reason?.trim() ? `${label} — ${reason.trim()}` : label;
};

export function selectTargets(input: SelectInput): { targets: Target[]; skipped: Skipped[] } {
  const targets: Target[] = [];
  const skipped: Skipped[] = [];
  const seen = new Set<string>();

  // 배치 안 작업이 가장 먼저 — 같은 상자가 버킷에도 있으면 배치 쪽이 이긴다.
  for (const { batch, workItems } of input.batches) {
    const individual = batch.pickingMethod === 'individual';
    const usable = individual && (batch.startedAt != null || batch.id === input.ownBatchId);
    const foreignBatch = input.foreign?.batches.get(batch.id);
    for (const item of workItems) {
      if (seen.has(item.shipmentId)) continue;
      const id = item.shipmentId;
      if (item.status === 'completed' || item.status === 'excluded') continue; // 무시(자리도 안 잡는다)
      const foreignRun = foreignBatch ?? input.foreign?.shipments.get(id);
      if (foreignRun !== undefined) {
        skipped.push({ shipmentId: id, reason: foreignReason(foreignRun) });
        seen.add(id);
        continue;
      }
      switch (item.status) {
        case 'ready_to_pack':
        case 'packing':
          targets.push({ shipmentId: id, from: 'batch', batchId: batch.id, route: 'force' });
          break;
        case 'queued':
        case 'picking':
          if (usable) {
            targets.push({ shipmentId: id, from: 'batch', batchId: batch.id, route: 'location' });
          } else {
            skipped.push({
              shipmentId: id,
              reason: individual ? REASON_NOT_STARTED : REASON_OTHER_METHOD,
            });
          }
          break;
        case 'withdrawing':
        case 'short_pick_recovery':
          skipped.push({ shipmentId: id, reason: `배치 작업 상태 ${item.status}` });
          break;
        default:
          continue;
      }
      seen.add(id);
    }
  }

  const take = (list: PreparationShipment[], from: 'draft' | 'planned') => {
    for (const s of list) {
      if (seen.has(s.shipmentId)) continue;
      seen.add(s.shipmentId);
      const foreignRun = input.foreign?.shipments.get(s.shipmentId);
      if (foreignRun !== undefined) {
        skipped.push({ shipmentId: s.shipmentId, reason: foreignReason(foreignRun), orderNos: s.orderNos });
        continue;
      }
      targets.push({ shipmentId: s.shipmentId, from });
    }
  };
  take(input.ready, 'draft');
  take(input.resume, 'planned');

  for (const { bucket, shipments } of input.otherBuckets) {
    for (const s of shipments) {
      if (seen.has(s.shipmentId)) continue;
      seen.add(s.shipmentId);
      skipped.push({
        shipmentId: s.shipmentId,
        reason: bucket === 'mergeable' ? REASON_MERGEABLE : bucketReason(bucket, s.reason),
        orderNos: s.orderNos,
      });
    }
  }

  return { targets, skipped };
}
