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
}

/** 박스 화면이 남기는 표시용 이름(송장) — 작업 기록 본문에는 박스 id 만 있다 */
export const boxCheckLabelsKey = (scope: string) => `${scope}:box-check-labels`;

export async function rememberBoxLabel(
  store: OperationStore,
  scope: string,
  shipmentId: string,
  label: BoxCheckLabel
) {
  await store.draft<Record<string, BoxCheckLabel>>(
    boxCheckLabelsKey(scope),
    (labels) =>
      labels?.[shipmentId]?.trackingNo === label.trackingNo
        ? labels
        : { ...labels, [shipmentId]: label }
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
