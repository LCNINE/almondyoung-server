import { ApiError, ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { DevicePrefs } from '../../core/data/devicePrefs';
import {
  errorMessage,
  WAYBILL_LABEL_NOT_ALLOCATED_MESSAGE,
  WAYBILL_NOT_DISPATCHABLE_MESSAGE,
  WAYBILL_STALE_MESSAGE,
} from '../../core/data/errorMessage';
import {
  PRINTER_FAILURE_MESSAGE,
  PrinterError,
  type PrintRaw,
} from '../../core/hardware/print/labelPrinter';

/** GET /shipments/:id/waybill/label (#913). core 가 마스킹·템플릿·래스터화까지 끝낸 프린터 바이트. */
export interface WaybillLabel {
  waybillId: string;
  trackingNo: string;
  format: string;
  data: string;
  /** data 안의 쪽 수(#913 품목 줄). 품목이 4줄을 넘는 FS 는 2 이상 — 이 필드가 없던 core 는 늘 1장이다. */
  pages?: number;
  /** 이 종이의 내용 지문 — 인쇄 성공 뒤 그대로 확인에 보낸다. */
  fingerprint: string;
  /** 판차 — 2 이상이면 종이에 N판. */
  revision: number;
}

export type LabelState =
  | 'current'
  | 'never_printed'
  | 'reprint_required'
  | 'not_started'
  | 'external'
  | 'unavailable'
  | 'withdrawing'
  | 'withdrawn';

export interface LabelItemChange {
  locationCode: string;
  skuId: string;
  name: string;
  printedQty: number;
  currentQty: number;
}

export interface BatchLabelState {
  shipmentId: string;
  workItemId: string;
  state: LabelState;
  changes: LabelItemChange[];
  issue: string | null;
}

export function confirmLabelPrinted(api: ApiClient, shipmentId: string, fingerprint: string): Promise<void> {
  return api.request<void>({ method: 'POST', path: `/shipments/${shipmentId}/waybill/label-prints`, body: { fingerprint } });
}

export function fetchBatchLabelStates(api: ApiClient, batchId: string): Promise<BatchLabelState[]> {
  return api.request<BatchLabelState[]>({ path: `/outbound-batches/${batchId}/waybill-label-states` });
}

/** 「실패·미인쇄만 다시」 대상(스펙 §10.5) — 서버가 판정한 상태로. 이 기기의 지난 실행 결과가 아니다. */
export function reprintTargets(states: readonly BatchLabelState[]): string[] {
  return states.filter((s) => s.state === 'never_printed' || s.state === 'reprint_required').map((s) => s.shipmentId);
}

export interface BatchWorkItem {
  id: string;
  shipmentId: string;
  status: string;
}

export function fetchWaybillLabel(api: ApiClient, shipmentId: string): Promise<WaybillLabel> {
  return api.request<WaybillLabel>({ path: `/shipments/${shipmentId}/waybill/label` });
}

export function fetchBatchWorkItems(api: ApiClient, batchId: string): Promise<BatchWorkItem[]> {
  return api.request<BatchWorkItem[]>({ path: `/outbound-batches/${batchId}/work-items` });
}

// 이미 출고됐거나(completed) 배치에서 빠졌거나(excluded) 빠지는 중인(withdrawing) 박스는 송장이 필요 없다(I4).
const NOT_PRINTABLE = new Set(['completed', 'excluded', 'withdrawing']);

export function printableShipmentIds(items: BatchWorkItem[]): string[] {
  return items.filter((item) => !NOT_PRINTABLE.has(item.status)).map((item) => item.shipmentId);
}

// 라벨 API 의 409 는 응답 code 가 전부 CONFLICT 다 — @app/shared ConflictError 가 코드를 싣지 않는다.
// 사유는 메시지 앞머리(`WAYBILL_STALE: …`, core 의 WAYBILL.ERROR 상수)에만 있으므로 그걸 읽는다.
// 형식이 바뀌어도 문구가 「그 밖」으로 떨어질 뿐 인쇄 흐름은 깨지지 않는다.
const CODE_PREFIX = /^((?:WAYBILL|LABEL)_[A-Z_]+):/;

export function waybillConflictCode(error: unknown): string | undefined {
  if (!(error instanceof ConflictError)) return undefined;
  return CODE_PREFIX.exec(error.message)?.[1];
}

const CONFLICT_MESSAGES: Record<string, string> = {
  WAYBILL_NOT_DISPATCHABLE: WAYBILL_NOT_DISPATCHABLE_MESSAGE,
  WAYBILL_STALE: WAYBILL_STALE_MESSAGE,
  WAYBILL_LABEL_NOT_ALLOCATED: WAYBILL_LABEL_NOT_ALLOCATED_MESSAGE,
  WAYBILL_LABEL_UNAVAILABLE:
    '이 송장은 앱에서 인쇄할 수 없어요(수기 등록 또는 한진 외 택배사).',
};
const OTHER_CONFLICT = '송장 상태가 바뀌었어요. 관리자에게 문의해 주세요.';
const NOT_FOUND = '출고 정보를 찾을 수 없어요.';
const SERVER_FAILURE = '송장을 만들지 못했어요(서버 문제). 관리자에게 알려 주세요.';
const NETWORK_FAILURE = '서버에 연결하지 못했어요. 네트워크를 확인해 주세요.';

/** 서버가 200 에 빈 data 를 준 경우. print_raw 의 «nothing to print» 가 프린터 오류로 오인되지 않게 먼저 거른다. */
export class EmptyLabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyLabelError';
  }
}

function statusOf(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.status;
  if (error instanceof Error) {
    const match = /→\s*(\d{3})/.exec(error.message);
    return match ? Number(match[1]) : undefined;
  }
  return undefined;
}

export function labelErrorMessage(error: unknown): string {
  if (error instanceof PrinterError) return PRINTER_FAILURE_MESSAGE;
  if (error instanceof LabelConfirmError) {
    return error.reason instanceof ConflictError && /^LABEL_CONTENT_CHANGED:/.test(error.reason.message)
      ? '인쇄하는 사이 송장 내용이 바뀌었어요. 방금 나온 송장은 버리고 다시 인쇄해 주세요.'
      : '송장은 나왔지만 출력 확인을 저장하지 못했어요. 다시 인쇄해 주세요.';
  }
  if (error instanceof EmptyLabelError) return SERVER_FAILURE;
  if (error instanceof ConflictError) {
    const code = waybillConflictCode(error);
    return (code && CONFLICT_MESSAGES[code]) || OTHER_CONFLICT;
  }
  const status = statusOf(error);
  // 상태 코드가 없으면 응답을 못 받은 것이다 — httpClient 의 15초 타임아웃(abort)·연결 실패.
  // 「알 수 없는 오류」로 두면 배치 전체가 그 문구로 채워져 현장이 원인을 못 짚는다.
  if (status === undefined) return NETWORK_FAILURE;
  if (status === 404) return NOT_FOUND;
  if (status !== undefined && status >= 500) return SERVER_FAILURE;
  return errorMessage(error);
}

/** 종이는 나왔는데 출력 확인을 못 남겼다. 장수는 세되 건은 «다시» 대상으로 남긴다. */
export class LabelConfirmError extends Error {
  readonly pages: number;
  readonly reason: unknown;
  constructor(pages: number, reason: unknown) {
    super('label printed but confirmation failed');
    this.name = 'LabelConfirmError';
    this.pages = pages;
    this.reason = reason;
  }
}

export type LabelPrintDeps = {
  fetchLabel: (shipmentId: string) => Promise<WaybillLabel>;
  print: PrintRaw;
  confirm: (shipmentId: string, fingerprint: string) => Promise<void>;
  target: string;
};

/** 한 장. format 은 보지 않는다 — core 가 TSPL 로 옮겨도 앱을 다시 배포하지 않기 위해서다. */
export async function printOneLabel(deps: LabelPrintDeps, shipmentId: string): Promise<WaybillLabel> {
  const label = await deps.fetchLabel(shipmentId);
  if (!label.data) throw new EmptyLabelError(`empty label for shipment ${shipmentId}`);
  await deps.print(deps.target, label.data);
  // 전송 성공 뒤에만 확인한다(스펙 §10.3). 실패해도 종이는 이미 나왔다 — 장수는 세고 «다시» 대상으로 남긴다.
  try {
    await deps.confirm(shipmentId, label.fingerprint);
  } catch (error) {
    throw new LabelConfirmError(label.pages ?? 1, error);
  }
  return label;
}

export interface BatchPrintResult {
  printed: string[];
  skipped: { shipmentId: string; message: string }[];
  notAttempted: string[];
  printerError?: string;
  /** 프린터로 보낸 종이 장수 — 한 건이 여러 장일 수 있어 printed.length 와 다르다. */
  sheets: number;
}

/**
 * 배치 일괄 인쇄. 순차로 돈다 — 프린터는 한 줄로 받고, core 의 래스터화도 가볍지 않다.
 * API 거절은 건 단위(건너뛰고 계속), 프린터 실패는 실행 단위(즉시 중단): 프린터가 죽었는데
 * 남은 라벨을 서버에서 계속 렌더링할 이유가 없다.
 * 사람이 멈추면(shouldStop) 그 건부터 notAttempted 로 남긴다 — 「실패·미인쇄만 다시」가 이어 찍는다.
 */
export async function runBatchLabelPrint(
  o: LabelPrintDeps & {
    shipmentIds: string[];
    onProgress?: (done: number, total: number) => void;
    shouldStop?: () => boolean;
  }
): Promise<BatchPrintResult> {
  const result: BatchPrintResult = { printed: [], skipped: [], notAttempted: [], sheets: 0 };
  const total = o.shipmentIds.length;
  for (let i = 0; i < total; i++) {
    if (o.shouldStop?.()) {
      result.notAttempted = o.shipmentIds.slice(i);
      return result;
    }
    const shipmentId = o.shipmentIds[i];
    try {
      const label = await printOneLabel(o, shipmentId);
      result.printed.push(shipmentId);
      result.sheets += label.pages ?? 1;
    } catch (error) {
      if (error instanceof PrinterError) {
        result.printerError = error.detail;
        result.notAttempted = o.shipmentIds.slice(i);
        return result;
      }
      if (error instanceof LabelConfirmError) result.sheets += error.pages;
      result.skipped.push({ shipmentId, message: labelErrorMessage(error) });
    }
    o.onProgress?.(i + 1, total);
  }
  return result;
}

const batchKey = (batchId: string) => `almondwms.labelPrinter.batch.${batchId}`;

/** 이 기기에서 이 배치를 마지막으로 인쇄한 시각(ISO). 서버에는 남기지 않는다(스펙 §8). */
export function readBatchPrintedAt(prefs: DevicePrefs, batchId: string): string | null {
  return prefs.get(batchKey(batchId));
}

export function writeBatchPrintedAt(prefs: DevicePrefs, batchId: string, iso: string): void {
  prefs.set(batchKey(batchId), iso);
}
