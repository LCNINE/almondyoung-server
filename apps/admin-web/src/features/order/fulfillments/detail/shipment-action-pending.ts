import { useMemo, useSyncExternalStore } from 'react';
import type { ShipmentAction } from './shipment-owner';

// 응답을 받지 못한 상자 작업의 요청 키. 새로고침하거나 다른 상자를 열어도 결과를 확인할 수 있게
// 브라우저에 남긴다. 받는 분 주소처럼 창에 입력한 내용은 남기지 않는다.
export type PendingRequest = {
  shipmentId: string;
  action: ShipmentAction;
  idempotencyKey: string;
  sentAt: number;
};

export const REQUEST_COMMAND_TYPE: Record<ShipmentAction, string> = {
  split: 'shipment.split',
  recipient: 'shipment.recipient_revision',
  plan: 'shipment.plan',
  recall: 'shipment.dispatch.recall',
};

// 요청마다 키를 따로 둔다 — 배열 하나를 읽고 덮어쓰면 여러 탭이 동시에 쓸 때 서로의 기록을 지운다
const KEY_PREFIX = 'almond.shipment-action-pending.v1:';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIONS = new Set<string>(Object.keys(REQUEST_COMMAND_TYPE));
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 남은 요청 전부를 한 문자열로 — 바뀌었는지 비교하는 스냅샷이다 */
function readRaw(): string {
  const store = storage();
  if (!store) return '';
  try {
    const lines: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(KEY_PREFIX)) {
        lines.push(store.getItem(key) ?? '');
      }
    }
    return lines.sort().join('\n');
  } catch {
    return '';
  }
}

function isPending(value: unknown): value is PendingRequest {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.shipmentId === 'string' &&
    typeof entry.action === 'string' &&
    ACTIONS.has(entry.action) &&
    typeof entry.idempotencyKey === 'string' &&
    typeof entry.sentAt === 'number'
  );
}

function parse(raw: string, now: number): PendingRequest[] {
  const entries: PendingRequest[] = [];
  for (const line of raw ? raw.split('\n') : []) {
    try {
      const value: unknown = JSON.parse(line);
      if (isPending(value) && now - value.sentAt < MAX_AGE_MS) {
        entries.push(value);
      }
    } catch {
      // 깨진 기록은 건너뛴다
    }
  }
  return entries.sort((a, b) => a.sentAt - b.sentAt);
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function pendingRequests(now = Date.now()): PendingRequest[] {
  return parse(readRaw(), now);
}

/** 보내기 전에 남긴다 — 같은 키를 다시 보내도 처음 보낸 시각을 지킨다 */
export function rememberPending(request: PendingRequest) {
  const store = storage();
  if (!store) return;
  const key = KEY_PREFIX + request.idempotencyKey;
  try {
    if (store.getItem(key)) return;
    store.setItem(
      key,
      JSON.stringify({
        shipmentId: request.shipmentId,
        action: request.action,
        idempotencyKey: request.idempotencyKey,
        sentAt: request.sentAt,
      })
    );
  } catch {
    // 저장소를 쓸 수 없으면 이 화면에 머무는 동안의 «다시 시도»만 남는다
  }
  notify();
}

/** 서버의 답(처리 결과·거절)을 받았거나 관리자가 결과를 확인하면 지운다 */
export function forgetPending(idempotencyKey: string) {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY_PREFIX + idempotencyKey);
  } catch {
    return;
  }
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // 다른 탭에서 바뀌어도 따라간다
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(KEY_PREFIX)) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** 남아 있는 요청 — 상자를 주면 그 상자 것만 */
export function usePendingRequests(shipmentId?: string): PendingRequest[] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => '');
  return useMemo(
    () =>
      parse(raw, Date.now()).filter(
        (entry) => !shipmentId || entry.shipmentId === shipmentId
      ),
    [raw, shipmentId]
  );
}
