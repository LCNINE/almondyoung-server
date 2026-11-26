import { useEffect, useSyncExternalStore } from 'react';
import type { OperationStore, StoredOperation } from './operationStore';

const SHIPMENT_PATH = /^\/shipments\/([^/]+)\//;

// 응답 필터는 403 을 FORBIDDEN 으로, Nest 기본 예외 본문은 Forbidden 으로 싣는다.
export const deniedByPermission = (o: StoredOperation) =>
  o.errorStatus === 403 ||
  Boolean(o.requiredPermissions?.length) ||
  o.errorCode === 'FORBIDDEN' ||
  o.errorCode === 'Forbidden';

export function shipmentOf(path: string): string | null {
  return SHIPMENT_PATH.exec(path)?.[1] ?? null;
}

/**
 * 박스 하나에 묶인 «결과 모름» — 그 박스만 막고 기기의 다른 작업은 막지 않는다. 같은 키로 다시 보내면 서버가
 * 저장한 결과를 돌려주므로 내려놓아도 잃지 않는다. 로그인·권한에서 막힌 것은 다시 로그인이 필요해 기기 전체 안내로 남긴다
 */
export const isBoxCheck = (o: StoredOperation) =>
  // 다시 보내는 중(두 번째 시도부터)도 결과 모름이다 — 확인하는 동안 목록에서 빠져 기기를 막지 않게
  (o.status === 'uncertain' || (o.status === 'sending' && o.attempts > 1)) &&
  shipmentOf(o.path) !== null &&
  o.errorStatus !== 401 &&
  !deniedByPermission(o);

export interface BoxCheckLabel {
  trackingNo: string;
  /** 찍은 바코드 → 상품 이름. 작업 기록 본문에는 바코드만 있다 */
  items?: Record<string, string>;
}

/** 박스에 묶인 작업이 무엇이었는지 — 찍은 상품 이름(모르면 바코드)과 수량 */
export function boxCheckWhat(
  op: StoredOperation,
  label: BoxCheckLabel | undefined
): string {
  try {
    const body = JSON.parse(op.bodyJson) as {
      barcode?: unknown;
      quantity?: unknown;
    };
    if (typeof body.barcode === 'string') {
      const quantity = typeof body.quantity === 'number' ? body.quantity : 1;
      const name = label?.items?.[body.barcode];
      return `${name ?? `상품 바코드 ${body.barcode}`} ×${quantity}`;
    }
  } catch {
    // 본문을 못 읽으면 무엇을 했는지만 적는다
  }
  return op.path.endsWith('-forces') ? '강제출고' : '박스 작업';
}

/** 박스 화면이 남기는 표시용 이름(송장·상품) — 작업 기록 본문에는 박스 id 와 바코드만 있다 */
export const boxCheckLabelsKey = (scope: string) => `${scope}:box-check-labels`;

export async function rememberBoxLabel(
  store: OperationStore,
  scope: string,
  shipmentId: string,
  label: BoxCheckLabel
) {
  await store.draft<Record<string, BoxCheckLabel>>(
    boxCheckLabelsKey(scope),
    (labels) => {
      const saved = labels?.[shipmentId];
      const items = {
        ...(saved?.trackingNo === label.trackingNo ? saved.items : undefined),
        ...label.items,
      };
      const unchanged =
        saved?.trackingNo === label.trackingNo &&
        Object.entries(items).every(
          ([code, name]) => saved.items?.[code] === name
        );
      if (unchanged && labels) return labels;
      return {
        ...labels,
        [shipmentId]: Object.keys(items).length
          ? { trackingNo: label.trackingNo, items }
          : { trackingNo: label.trackingNo },
      };
    }
  );
}

/** 단순출고 스캔 초안의 키(useWorkScanQueue 의 `${scope}:scan:${storageKey}`, 화면들의 `outbound:${shipmentId}`) */
const simpleScanDraftKey = (scope: string, shipmentId: string) =>
  `${scope}:scan:outbound:${shipmentId}`;

export async function forgetScanDraft(
  store: OperationStore,
  scope: string,
  shipmentId: string,
  operationId: string
) {
  const key = simpleScanDraftKey(scope, shipmentId);
  const events = await store.draft<Array<{ id: string }>>(key);
  if (events?.some((e) => e.id === operationId))
    await store.draft<Array<{ id: string }>>(key, (list) =>
      (list ?? []).filter((e) => e.id !== operationId)
    );
}

// «확인할 일» 단추를 그리는 곳 — 스테이션은 상태바가 맡고, 상태바가 없는 화면(핸드헬드)은 작업 경계가 맡는다
let hosts = 0;
const hostListeners = new Set<() => void>();
const setHosts = (n: number) => {
  hosts = n;
  hostListeners.forEach((fn) => fn());
};
export function useHostBoxChecks() {
  useEffect(() => {
    setHosts(hosts + 1);
    return () => setHosts(hosts - 1);
  }, []);
}
export function useBoxChecksHosted(): boolean {
  return useSyncExternalStore(
    (fn) => {
      hostListeners.add(fn);
      return () => {
        hostListeners.delete(fn);
      };
    },
    () => hosts > 0
  );
}

// «확인할 일» 을 여는 요청 — 기능키(스테이션 송장 대기 F8)가 상태바의 목록을 연다
const openListeners = new Set<() => void>();
export function requestBoxChecksOpen() {
  openListeners.forEach((fn) => fn());
}
export function useBoxChecksOpenRequests(onOpen: () => void) {
  useEffect(() => {
    openListeners.add(onOpen);
    return () => {
      openListeners.delete(onOpen);
    };
  }, [onOpen]);
}
