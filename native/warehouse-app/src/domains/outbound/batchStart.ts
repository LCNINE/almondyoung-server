import { ConflictError, type ApiClient } from '../../core/data/httpClient';

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
    guidance: '적치를 끝낸 뒤 다시 「작업 시작」을 누르거나, 관리자 화면에서 이 박스를 배치에서 빼고 시작하세요.',
  },
  STOCK_SHORT: { title: '재고 부족', guidance: '관리자 화면에서 이 박스를 배치에서 빼고 시작하세요.' },
  WAYBILL_NOT_READY: {
    title: '송장 미발급·재발급 필요',
    guidance: '송장을 발급(재발급)한 뒤 다시 시작하거나, 관리자 화면에서 이 박스를 배치에서 빼고 시작하세요.',
  },
  CANCEL_REQUESTED: {
    title: '취소 처리 중인 주문',
    guidance: '취소가 끝나면 이 박스는 빠집니다. 관리자 화면에서 이 박스를 배치에서 빼고 시작하세요.',
  },
};

const tracking = (b: StartBlocker) =>
  b.trackingNo && /^\d{12}$/.test(b.trackingNo)
    ? b.trackingNo.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3')
    : (b.trackingNo ?? `박스 ${b.shipmentId.slice(0, 8)}`);

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
