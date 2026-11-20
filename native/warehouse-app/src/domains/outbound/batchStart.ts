import { ConflictError, NetworkError, type ApiClient } from '../../core/data/httpClient';
import { errorMessage } from '../../core/data/errorMessage';
import { excludeFromBatch } from './batchRemove';

export type StartBlockReason = 'INBOUND_PENDING' | 'STOCK_SHORT' | 'WAYBILL_NOT_READY' | 'CANCEL_REQUESTED';

/** core `StartBlockerView` 와 같은 모양(picking/allocation/allocation.types.ts). */
export interface StartBlocker {
  shipmentId: string;
  reason: StartBlockReason;
  shipmentLineId: string | null;
  skuId: string | null;
  requiredQty: number | null;
  shortQty: number | null;
  detail: string | null;
  /** 박스에 든 주문번호. 옛 core 는 보내지 않는다. */
  orderNos?: string[];
  trackingNo: string | null;
  skuCode: string | null;
  skuName: string | null;
}

export interface BatchStartResult {
  state: 'started';
  batchId: string;
  sessionId: string;
}

/** 「작업 시작」 — 멱등. 같은 배치에 다시 보내도 같은 세션이다. 키는 누를 때마다 새로 만든다. */
export function startBatch(api: ApiClient, batchId: string, idempotencyKey: string): Promise<BatchStartResult> {
  return api.request<BatchStartResult>({ method: 'POST', path: '/picking/v2/starts', body: { batchId }, idempotencyKey });
}

const REASONS: readonly StartBlockReason[] = ['INBOUND_PENDING', 'STOCK_SHORT', 'WAYBILL_NOT_READY', 'CANCEL_REQUESTED'];

function isBlocker(value: unknown): value is StartBlocker {
  if (typeof value !== 'object' || value === null) return false;
  const v: { shipmentId?: unknown; reason?: unknown } = value;
  return typeof v.shipmentId === 'string' && REASONS.some((r) => r === v.reason);
}

/** 409 본문의 errors 가 차단 목록이면 그 목록, 아니면 null. 시작(BATCH_START_BLOCKED)·합류(BATCH_JOIN_BLOCKED) 공용. */
export function blockersOf(error: unknown, code: string): StartBlocker[] | null {
  if (!(error instanceof ConflictError) || error.code !== code || !Array.isArray(error.errors)) return null;
  return error.errors.filter(isBlocker);
}

/** 시작 거절(BATCH_START_BLOCKED)이면 막힌 박스 목록, 아니면 null. */
export function startBlockersOf(error: unknown): StartBlocker[] | null {
  return blockersOf(error, 'BATCH_START_BLOCKED');
}

export interface BlockerGroup {
  reason: StartBlockReason;
  title: string;
  guidance: string;
  rows: string[];
}

export type BlockerText = Record<StartBlockReason, { title: string; guidance: string }>;

const START_BLOCKER_TEXT: BlockerText = {
  INBOUND_PENDING: {
    title: '적치 대기 중인 상품',
    guidance: '적치를 끝낸 뒤 다시 「작업 시작」을 누르거나, 아래 «막힌 박스 빼고 나머지로 시작»을 누르세요.',
  },
  STOCK_SHORT: { title: '재고 부족', guidance: '아래 «막힌 박스 빼고 나머지로 시작»을 누르세요.' },
  WAYBILL_NOT_READY: {
    title: '송장 미발급·재발급 필요',
    guidance: '관리자 화면에서 송장을 발급(재발급)한 뒤 다시 시작하거나, 아래 «막힌 박스 빼고 나머지로 시작»을 누르세요.',
  },
  CANCEL_REQUESTED: {
    title: '취소 처리 중인 주문',
    guidance: '취소 처리가 끝날 때까지 이 박스는 출고할 수 없어요. 아래 «막힌 박스 빼고 나머지로 시작»을 누르세요.',
  },
};

/** 현장이 알아보는 이름 — 주문번호, 송장번호. 둘 다 없을 때만 박스 번호 앞자리 */
const tracking = (b: StartBlocker) => {
  const orders = Array.isArray(b.orderNos) && b.orderNos.length ? `주문 ${b.orderNos.join(', ')}` : null;
  const waybill =
    b.trackingNo && /^\d{12}$/.test(b.trackingNo)
      ? b.trackingNo.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3')
      : b.trackingNo;
  const names = [orders, waybill].filter((name): name is string => !!name);
  return names.length ? names.join(' · ') : `박스 ${b.shipmentId.slice(0, 8)}`;
};

function rowOf(b: StartBlocker): string {
  if (b.reason === 'CANCEL_REQUESTED') return `${tracking(b)} · 취소 처리 중`;
  if (b.reason === 'WAYBILL_NOT_READY') return `${tracking(b)} · 송장 재발급 필요`;
  return `${tracking(b)} · ${b.skuName ?? b.skuCode ?? '상품'} ${b.requiredQty ?? '?'}개 중 ${b.shortQty ?? '?'}개 부족`;
}

export function groupBlockers(blockers: readonly StartBlocker[], text: BlockerText): BlockerGroup[] {
  return REASONS.flatMap((reason) => {
    const rows = blockers.filter((b) => b.reason === reason).map(rowOf);
    return rows.length ? [{ reason, ...text[reason], rows }] : [];
  });
}

/** 사유별로 묶는다(스펙 §6 «앱은 사유별로 묶어 안내한다»). 순서는 적치 대기 → 재고 부족 → 송장. */
export function groupStartBlockers(blockers: readonly StartBlocker[]): BlockerGroup[] {
  return groupBlockers(blockers, START_BLOCKER_TEXT);
}

export interface SkippedBlocker {
  shipmentId: string;
  label: string;
  message: string;
  /** 서버가 뺐는지 모른다(응답을 잃었거나 앞 요청이 아직 처리 중) — 목록에서 확인할 박스 */
  uncertain: boolean;
}

/** 다시 보내도 결과를 모르는 거절 — 앞 요청이 끝나면 빠져 있을 수 있다 */
function isOutcomeUnknown(error: unknown): boolean {
  return error instanceof NetworkError || (error instanceof ConflictError && error.code === 'FULFILLMENT_COMMAND_IN_PROGRESS');
}

export type StartAttempt = { kind: 'started'; result: BatchStartResult } | { kind: 'failed'; error: unknown };

/**
 * 막힌 박스를 배치에서 빼고 남은 박스로 다시 시작한다. 시작은 전부 아니면 전무라 서버는 막힌 박스가 하나라도 있으면
 * 아무것도 시작하지 않는다 — 안내문이 «배치에서 빼고 시작하세요»라고 시키던 일을 그 자리에서 한다.
 *
 * 화면의 목록은 낡았을 수 있다(그 사이 송장을 다시 받았거나 적치가 끝났다). 그래서 빼기 전에 시작을 한 번 더 보내
 * 지금 막힌 박스를 받고, 그중 화면에 보였던 박스만 뺀다 — 풀린 박스는 빼지 않고, 새로 막힌 박스는 보이고 나서 뺀다.
 * 빼지 못한 박스가 있어도 시작을 보낸다: 그 박스는 다시 막힌 박스로 돌아와 화면에 남는다.
 */
export async function excludeBlockedAndStart(
  deps: { api: ApiClient; newKey: () => string },
  batchId: string,
  shown: readonly StartBlocker[],
): Promise<{ removedIds: string[]; skipped: SkippedBlocker[]; start: StartAttempt }> {
  const tryStart = async (): Promise<StartAttempt> => {
    try {
      return { kind: 'started', result: await startBatch(deps.api, batchId, deps.newKey()) };
    } catch (error) {
      return { kind: 'failed', error };
    }
  };
  const first = await tryStart();
  if (first.kind === 'started') return { removedIds: [], skipped: [], start: first };
  const current = startBlockersOf(first.error);
  if (!current) return { removedIds: [], skipped: [], start: first };

  const shownIds = new Set(shown.map((blocker) => blocker.shipmentId));
  const byShipment = new Map<string, StartBlocker>();
  for (const blocker of current) {
    if (shownIds.has(blocker.shipmentId) && !byShipment.has(blocker.shipmentId)) byShipment.set(blocker.shipmentId, blocker);
  }
  if (byShipment.size === 0) return { removedIds: [], skipped: [], start: first };

  const removedIds: string[] = [];
  const skipped: SkippedBlocker[] = [];
  for (const blocker of byShipment.values()) {
    const input = {
      batchId,
      shipmentId: blocker.shipmentId,
      reason: `작업 시작 전 뺌 — ${START_BLOCKER_TEXT[blocker.reason].title}`,
      idempotencyKey: deps.newKey(),
    };
    try {
      try {
        await excludeFromBatch(deps.api, input);
      } catch (error) {
        // 응답만 잃었을 수 있다 — 같은 키로 다시 보내면 서버가 처음 결과를 돌려준다
        if (!(error instanceof NetworkError)) throw error;
        await excludeFromBatch(deps.api, input);
      }
      removedIds.push(blocker.shipmentId);
    } catch (error) {
      skipped.push({ shipmentId: blocker.shipmentId, label: tracking(blocker), message: errorMessage(error, 'outbound'), uncertain: isOutcomeUnknown(error) });
    }
  }
  return { removedIds, skipped, start: await tryStart() };
}

/** 막힌 박스를 다 빼서 배치가 비었다 */
export function isEmptyBatchError(error: unknown): boolean {
  return error instanceof ConflictError && error.code === 'PICKING_BATCH_EMPTY';
}
