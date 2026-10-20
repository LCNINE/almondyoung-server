import {
  CancellationEffect,
  CancellationLineContext,
  CancellationLineDraft,
  deriveCancellationLines,
} from '../../apps/core/src/modules/sales-order/cancellation-record/cancellation-lines';

export type BackfillCancellation = {
  id: string;
  scope: 'full' | 'partial';
  /** jsonb 원본 — 런타임에 좁힌다. */
  metadata: unknown;
  /** jsonb 원본 — 런타임에 좁힌다. */
  effects: unknown;
  occurredAt: Date;
  /** 이미 라인 행이 있는 취소(배포 뒤 새 취소)의 행. 비어 있으면 아직 없다. */
  existingLines: Array<{ salesOrderLineId: string; quantity: number }>;
};

export type OrderBackfillPlan =
  | { kind: 'ok'; inserts: Array<CancellationLineDraft & { cancellationId: string }> }
  | { kind: 'ambiguous'; cancellationId: string; reason: string };

class Ambiguous extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** metadata.cancelledLines → 항목이 모두 {salesOrderLineId: string, quantity: number} 인 배열, 없으면 null. 그 외는 모호. */
function readCancelledLines(
  scope: 'full' | 'partial',
  metadata: unknown,
): Array<{ salesOrderLineId: string; quantity: number }> | null {
  const raw = isRecord(metadata) ? metadata.cancelledLines : undefined;
  if (raw === undefined || raw === null) {
    // partial 은 cancelledLines 가 본질이다 — 없으면 [] 로 조용히 넘기지 않는다. full(v1)은 없는 게 정상.
    if (scope === 'partial') throw new Ambiguous('partial 취소에 metadata.cancelledLines 가 없다');
    return null;
  }
  if (!Array.isArray(raw)) throw new Ambiguous('metadata.cancelledLines 가 배열이 아니다');
  const entries: Array<{ salesOrderLineId: string; quantity: number }> = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.salesOrderLineId !== 'string' || typeof item.quantity !== 'number') {
      throw new Ambiguous('metadata.cancelledLines 항목이 {salesOrderLineId: string, quantity: number} 가 아니다');
    }
    entries.push({ salesOrderLineId: item.salesOrderLineId, quantity: item.quantity });
  }
  return entries;
}

function readEffects(effects: unknown): CancellationEffect[] {
  if (!Array.isArray(effects)) throw new Ambiguous('effects 가 배열이 아니다');
  const result: CancellationEffect[] = [];
  for (const item of effects) {
    if (!isRecord(item) || typeof item.type !== 'string') throw new Ambiguous('effects 항목에 type 문자열이 없다');
    result.push({ type: item.type, metadata: isRecord(item.metadata) ? item.metadata : undefined });
  }
  return result;
}

/**
 * 주문 하나의 옛 취소를 occurredAt·id 순으로 재생해 넣을 라인 행을 낸다 (순수 함수).
 * 하나라도 해석이 모호하면 그 주문은 한 행도 내지 않고 ambiguous 로 보고한다.
 */
export function planOrderBackfill(
  lines: CancellationLineContext[],
  cancellations: BackfillCancellation[],
): OrderBackfillPlan {
  const ordered = [...cancellations].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const prior = new Map<string, number>();
  const addPrior = (lineId: string, quantity: number) => prior.set(lineId, (prior.get(lineId) ?? 0) + quantity);
  const inserts: Array<CancellationLineDraft & { cancellationId: string }> = [];

  for (const cancellation of ordered) {
    if (cancellation.existingLines.length > 0) {
      for (const row of cancellation.existingLines) addPrior(row.salesOrderLineId, row.quantity);
      continue;
    }
    try {
      const drafts = deriveCancellationLines({
        scope: cancellation.scope,
        cancelledLines: readCancelledLines(cancellation.scope, cancellation.metadata),
        effects: readEffects(cancellation.effects),
        lines,
        priorCancelledByLine: new Map(prior),
      });
      for (const draft of drafts) {
        addPrior(draft.salesOrderLineId, draft.quantity);
        inserts.push({ ...draft, cancellationId: cancellation.id });
      }
    } catch (error) {
      if (error instanceof Error) {
        return { kind: 'ambiguous', cancellationId: cancellation.id, reason: error.message };
      }
      throw error;
    }
  }
  return { kind: 'ok', inserts };
}

export type StoredLineRow = { cancellationId: string; salesOrderLineId: string; shipmentPhase: string; quantity: number };

/**
 * `--verify` 의 비교 (순수 함수). 다시 도출한 행 집합과 저장된 행 집합이 (취소, 라인, 갈래, 수량) 으로 같은지 본다.
 * 같으면 빈 배열, 다르면 어느 쪽에만 있는지 사람이 읽을 문장을 돌려준다.
 */
export function diffDerivedWithStored(
  derived: Array<{ cancellationId: string; salesOrderLineId: string; shipmentPhase: string; quantity: number }>,
  stored: StoredLineRow[],
): string[] {
  const key = (r: StoredLineRow) => `${r.cancellationId}|${r.salesOrderLineId}|${r.shipmentPhase}|${r.quantity}`;
  const derivedKeys = new Map<string, number>();
  for (const r of derived) derivedKeys.set(key(r), (derivedKeys.get(key(r)) ?? 0) + 1);
  const storedKeys = new Map<string, number>();
  for (const r of stored) storedKeys.set(key(r), (storedKeys.get(key(r)) ?? 0) + 1);
  const diffs: string[] = [];
  for (const [k, n] of derivedKeys) if ((storedKeys.get(k) ?? 0) < n) diffs.push(`도출에만 있음: ${k}`);
  for (const [k, n] of storedKeys) if ((derivedKeys.get(k) ?? 0) < n) diffs.push(`저장에만 있음: ${k}`);
  return diffs;
}
