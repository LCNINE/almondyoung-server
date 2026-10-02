import { errorMessage } from '../../core/data/errorMessage';
import { ApiError, type ApiClient } from '../../core/data/httpClient';
import type { ShipmentByWaybill, ShipmentByWaybillLine, ShipmentLineAllocation, SimpleOutboundLineProgress } from './types';

export type ShortPickReason = 'inventory_shortage' | 'item_damaged';

/** 결품 창 사유 키(스펙 §7.1-2, U10). 파손도 결품과 같은 경로, 사유만 다르다 */
export const SHORT_PICK_REASON_KEYS: ReadonlyArray<{ key: string; reason: ShortPickReason; label: string }> = [
  { key: '1', reason: 'inventory_shortage', label: '재고 부족' },
  { key: '2', reason: 'item_damaged', label: '파손' },
];

export interface ShortPickDraftLine {
  shipmentLineId: string;
  name: string;
  /** 남은 수량 — 줄일 수만 있다 */
  max: number;
  qty: number;
}

/** 덜 찍힌 줄을 «주문 − 스캔» 으로 미리 채운다(스펙 §7.1-1) */
export function shortPickDraft(
  lines: readonly ShipmentByWaybillLine[],
  progress: readonly SimpleOutboundLineProgress[]
): ShortPickDraftLine[] {
  const picked = new Map(progress.map((p) => [p.shipmentLineId, p.pickedQty]));
  return lines.flatMap((line) => {
    const max = line.qty - (picked.get(line.shipmentLineId) ?? 0);
    return max > 0 ? [{ shipmentLineId: line.shipmentLineId, name: line.skuName, max, qty: max }] : [];
  });
}

/**
 * 결품을 보고할 위치(스펙 §7.1-4·U11, 2026-10-02 결정). 서버는 스캔을 송장 순서(배정 순서)로 귀속한다(core A1) — 그 귀속을
 * 재구성해 위치마다 «안 집은 몫» 을 구하고, 결품을 마지막 위치부터 그 몫만큼 채워 앞으로 넘긴다. 마지막 위치 몫 이하면 U11
 * 그대로 마지막 위치 하나다. 서버는 (줄, 위치)의 안 집은 몫을 넘는 결품을 409 SHORT_PICK_EXCEEDS_UNPICKED 로 거절한다.
 * 다 담지 못하거나 결품이 0 이면 null.
 */
export function shortPickSources(
  allocations: readonly ShipmentLineAllocation[],
  pickedQty: number,
  shortQty: number
): Array<{ sourceLocationId: string; shortQty: number }> | null {
  // 서버가 위치별 귀속(pickedQty)을 주면 그대로 쓴다 — 핸드헬드의 위치 지정 스캔·보충 배정은 코드 순 채우기와 어긋난다.
  // 없으면(옛 core) 줄 합계를 배정 순서대로 채워 재구성한다.
  const serverAttributed = allocations.every((allocation) => allocation.pickedQty !== undefined);
  let picked = pickedQty;
  const unpicked = allocations.map((allocation) => {
    if (serverAttributed) {
      return { sourceLocationId: allocation.sourceLocationId, unpicked: allocation.qty - (allocation.pickedQty ?? 0) };
    }
    const attributed = Math.min(allocation.qty, Math.max(0, picked));
    picked -= attributed;
    return { sourceLocationId: allocation.sourceLocationId, unpicked: allocation.qty - attributed };
  });
  let left = shortQty;
  const sources: Array<{ sourceLocationId: string; shortQty: number }> = [];
  for (let i = unpicked.length - 1; i >= 0 && left > 0; i--) {
    const take = Math.min(unpicked[i].unpicked, left);
    if (take > 0) {
      sources.unshift({ sourceLocationId: unpicked[i].sourceLocationId, shortQty: take });
      left -= take;
    }
  }
  return shortQty > 0 && left === 0 ? sources : null;
}

/** core `ReportShipmentShortPickDto` 와 같은 모양 */
export interface ShortPickRequest {
  workItemId: string;
  expectedWorkItemLeaseVersion: number;
  sessionId: string;
  expectedSessionVersion: number;
  expectedManifestVersion: number;
  lines: Array<{ shipmentLineId: string; sourceLocationId: string; expectedLineVersion: number; shortQty: number }>;
  reason: ShortPickReason;
}

export const SHORT_PICK_STALE_MESSAGE = '박스 상태가 바뀌었어요. 다시 F9 를 눌러 주세요.';
export const SHORT_PICK_UNAVAILABLE_MESSAGE = '이 박스는 지금 결품을 보고할 수 없어요. 송장을 다시 찍어 주세요.';

/** 결품은 대기·피킹 중일 때만(스펙 §11 PR A 계약 메모 — 빼는 중·다른 오퍼레이션 대기 중이면 서버가 409) */
const REPORTABLE_WORK_ITEM_STATUSES: readonly string[] = ['queued', 'picking'];

/** 보내기 직전에 다시 조회한 박스로 요청을 만든다 — 버전은 스캔마다 낡는다(PR A 계약 메모) */
export function buildShortPickRequest(
  fresh: ShipmentByWaybill,
  draft: ReadonlyArray<{ shipmentLineId: string; qty: number }>,
  reason: ShortPickReason
): { ok: true; request: ShortPickRequest } | { ok: false; message: string } {
  const context = fresh.shortPickContext;
  if (!fresh.workItemId || !context || !REPORTABLE_WORK_ITEM_STATUSES.includes(fresh.workItemStatus ?? ''))
    return { ok: false, message: SHORT_PICK_UNAVAILABLE_MESSAGE };
  const wanted = draft.filter((entry) => entry.qty > 0);
  if (wanted.length === 0) return { ok: false, message: '결품 수량이 없어요.' };
  const lines: ShortPickRequest['lines'] = [];
  for (const want of wanted) {
    const line = fresh.lines.find((l) => l.shipmentLineId === want.shipmentLineId);
    if (!line || line.lineVersion === undefined || !line.allocations) return { ok: false, message: SHORT_PICK_STALE_MESSAGE };
    if (want.qty > line.qty - line.pickedQty) return { ok: false, message: SHORT_PICK_STALE_MESSAGE };
    const sources = shortPickSources(line.allocations, line.pickedQty, want.qty);
    if (!sources) return { ok: false, message: SHORT_PICK_STALE_MESSAGE };
    for (const source of sources)
      lines.push({
        shipmentLineId: line.shipmentLineId,
        sourceLocationId: source.sourceLocationId,
        expectedLineVersion: line.lineVersion,
        shortQty: source.shortQty,
      });
  }
  return {
    ok: true,
    request: {
      workItemId: fresh.workItemId,
      expectedWorkItemLeaseVersion: context.workItemLeaseVersion,
      sessionId: context.sessionId,
      expectedSessionVersion: context.sessionVersion,
      expectedManifestVersion: context.manifestVersion,
      lines,
      reason,
    },
  };
}

/** 결품을 뺀 곳에서 다시 채운 몫 — 현장이 그 로케이션으로 가서 집는다(core `ShortPickRefillDto`) */
export interface ShortPickRefill {
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  locationCode: string;
  qty: number;
}

/** core `ShipmentShortPickResponseDto` 중 화면이 쓰는 것 */
export interface ShortPickResult {
  operationId: string;
  shipmentId: string;
  workItemId: string;
  operationStatus: 'pending' | 'completed';
  outcome: 'refilled' | 'withdrawing' | 'exited';
  refills: ShortPickRefill[];
}

export function reportShortPick(
  api: ApiClient,
  shipmentId: string,
  request: ShortPickRequest,
  idempotencyKey: string
): Promise<ShortPickResult> {
  return api.request<ShortPickResult>({
    method: 'POST',
    path: `/shipments/${shipmentId}/short-picks`,
    body: request,
    idempotencyKey,
  });
}

/** 버전·몫이 어긋난 거절 — 박스를 다시 보고 다시 보고하면 된다(`shipment-short-pick.service.ts`·`box-allocation.manager.ts`) */
const STALE_CODES: ReadonlySet<string> = new Set([
  'SHORT_PICK_SESSION_STALE',
  'SHIPMENT_STALE_MANIFEST_VERSION',
  'SHORT_PICK_LINE_STALE',
  'SHORT_PICK_WORK_ITEM_STALE',
  'SHORT_PICK_EXCEEDS_UNPICKED',
  'SHORT_PICK_ALLOCATION_MISMATCH',
  'SHORT_PICK_LINE_MISMATCH',
  'SHORT_PICK_WORK_ITEM_MISMATCH',
]);

const SHORT_PICK_MESSAGES: Record<string, string> = {
  SHORT_PICK_WORK_ITEM_STATE: SHORT_PICK_UNAVAILABLE_MESSAGE,
  SHORT_PICK_WORK_ITEM_WAITING: SHORT_PICK_UNAVAILABLE_MESSAGE,
  PICKING_SESSION_NOT_ACTIVE: SHORT_PICK_UNAVAILABLE_MESSAGE,
  SHORT_PICK_DISPATCH_EXISTS: '이미 출고된 박스예요.',
  SHORT_PICK_SHIPMENT_NOT_PLANNED: '출고 계획이 바뀐 박스예요. 관리자에게 문의해 주세요.',
  SHORT_PICK_INVOICE_NOT_VOIDABLE: '송장을 지금 처리할 수 없어 결품을 보고하지 못했어요. 관리자에게 문의해 주세요.',
};

export function shortPickErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && STALE_CODES.has(error.code)) return SHORT_PICK_STALE_MESSAGE;
    if (error.code && SHORT_PICK_MESSAGES[error.code]) return SHORT_PICK_MESSAGES[error.code];
    // outbound 문맥의 403 문구는 강제출고 권한이다 — 결품에는 결품 문구를 쓴다
    if (error.status === 403) return '결품 보고 권한이 없어요. 관리자에게 요청해 주세요.';
  }
  return errorMessage(error, 'outbound');
}
