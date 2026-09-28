import { ApiError, ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
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

// 이미 출고됐거나(completed) 배치에서 빠진(excluded) 박스는 라벨이 필요 없다.
const NOT_PRINTABLE = new Set(['completed', 'excluded']);

export function printableShipmentIds(items: BatchWorkItem[]): string[] {
  return items.filter((item) => !NOT_PRINTABLE.has(item.status)).map((item) => item.shipmentId);
}

// 라벨 API 의 409 는 응답 code 가 전부 CONFLICT 다 — @app/shared ConflictError 가 코드를 싣지 않는다.
// 사유는 메시지 앞머리(`WAYBILL_STALE: …`, core 의 WAYBILL.ERROR 상수)에만 있으므로 그걸 읽는다.
// 형식이 바뀌어도 문구가 「그 밖」으로 떨어질 뿐 인쇄 흐름은 깨지지 않는다.
const CODE_PREFIX = /^(WAYBILL_[A-Z_]+):/;

export function waybillConflictCode(error: unknown): string | undefined {
  if (!(error instanceof ConflictError)) return undefined;
  return CODE_PREFIX.exec(error.message)?.[1];
}

const CONFLICT_MESSAGES: Record<string, string> = {
  WAYBILL_NOT_DISPATCHABLE:
    '한진 등록이 끝나지 않은 송장이에요. 관리자에게 운송장 발급 상태를 확인해 달라고 해 주세요.',
  WAYBILL_STALE:
    '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요.',
  WAYBILL_LABEL_UNAVAILABLE:
    '이 송장은 앱에서 인쇄할 수 없어요(수기 등록 또는 한진 외 택배사).',
};
const OTHER_CONFLICT = '송장 상태가 바뀌었어요. 관리자에게 문의해 주세요.';
const NOT_FOUND = '출고 정보를 찾을 수 없어요.';
const SERVER_FAILURE = '라벨을 만들지 못했어요(서버 문제). 관리자에게 알려 주세요.';
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

export type LabelPrintDeps = {
  fetchLabel: (shipmentId: string) => Promise<WaybillLabel>;
  print: PrintRaw;
  target: string;
};

/** 한 장. format 은 보지 않는다 — core 가 TSPL 로 옮겨도 앱을 다시 배포하지 않기 위해서다. */
export async function printOneLabel(deps: LabelPrintDeps, shipmentId: string): Promise<WaybillLabel> {
  const label = await deps.fetchLabel(shipmentId);
  if (!label.data) throw new EmptyLabelError(`empty label for shipment ${shipmentId}`);
  await deps.print(deps.target, label.data);
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
      result.skipped.push({ shipmentId, message: labelErrorMessage(error) });
    }
    o.onProgress?.(i + 1, total);
  }
  return result;
}

export function retryTargets(result: BatchPrintResult): string[] {
  return [...result.skipped.map((s) => s.shipmentId), ...result.notAttempted];
}

const batchKey = (batchId: string) => `almondwms.labelPrinter.batch.${batchId}`;

/** 이 기기에서 이 배치를 마지막으로 인쇄한 시각(ISO). 서버에는 남기지 않는다(스펙 §8). */
export function readBatchPrintedAt(prefs: DevicePrefs, batchId: string): string | null {
  return prefs.get(batchKey(batchId));
}

export function writeBatchPrintedAt(prefs: DevicePrefs, batchId: string, iso: string): void {
  prefs.set(batchKey(batchId), iso);
}
