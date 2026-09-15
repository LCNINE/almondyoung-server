import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useIsAuthenticated, useSession } from '../../app/session-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import {
  useWorkRuntime,
  type WorkRuntime,
} from '../../core/operations/OperationContext';

export const receiptActionBlockReasons = [
  'CANCELED',
  'ALREADY_PUTAWAY',
  'RETURN_EXISTS',
  'NOT_TODAY',
  'NOT_STAGING_ORIGIN',
  'ORIGIN_STOCK_INCONSISTENT',
  'MISSING_ORIGIN_OR_EVENT',
  'NOTHING_PENDING',
] as const;
export type ReceiptActionBlockReason =
  (typeof receiptActionBlockReasons)[number];
export interface ReceiptLineState {
  lineId: string;
  receiptId: string;
  warehouseId: string;
  source: 'direct' | 'purchase_order';
  receiptStatus: 'posted' | 'voided';
  skuId: string;
  skuCode: string;
  skuName: string;
  originLocationId: string | null;
  originLocationCode: string | null;
  quantity: number;
  putawayFromOriginQty: number;
  canceledQty: number;
  returnedQty: number;
  pendingQty: number;
  canPutaway: boolean;
  putawayBlockReason: ReceiptActionBlockReason | null;
  canCancel: boolean;
  cancelBlockReason: ReceiptActionBlockReason | null;
}
export class ReceiptStateError extends Error {}
export function validateReceiptLineState(
  value: unknown,
  lineId: string,
  warehouseId: string
): asserts value is ReceiptLineState {
  const row = value as Record<string, unknown> | null;
  const text = (v: unknown) => typeof v === 'string' && v.length > 0;
  const integer = (v: unknown) =>
    typeof v === 'number' && Number.isSafeInteger(v);
  const policy = (allowed: unknown, reason: unknown) =>
    typeof allowed === 'boolean' &&
    (allowed
      ? reason === null
      : receiptActionBlockReasons.includes(reason as ReceiptActionBlockReason));
  if (
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    row.lineId !== lineId ||
    row.warehouseId !== warehouseId ||
    ![
      row.lineId,
      row.receiptId,
      row.warehouseId,
      row.skuId,
      row.skuCode,
      row.skuName,
    ].every(text) ||
    (row.source !== 'direct' && row.source !== 'purchase_order') ||
    (row.receiptStatus !== 'posted' && row.receiptStatus !== 'voided') ||
    !(row.originLocationId === null || text(row.originLocationId)) ||
    !(row.originLocationCode === null || text(row.originLocationCode)) ||
    ![
      row.quantity,
      row.putawayFromOriginQty,
      row.canceledQty,
      row.returnedQty,
      row.pendingQty,
    ].every(integer) ||
    !policy(row.canPutaway, row.putawayBlockReason) ||
    !policy(row.canCancel, row.cancelBlockReason)
  )
    throw new ReceiptStateError(
      '입고 상태를 확인할 수 없어요. 연결과 업데이트를 확인한 뒤 다시 확인해 주세요.'
    );
}
export const receiptLineStateKey = (
  scope: string,
  warehouseId: string,
  lineId: string
) => ['inbound-receipt-state', scope, warehouseId, lineId] as const;

type ReadOptions = {
  expectedSource?: ReceiptLineState['source'];
  beforeRead?: (runtime: WorkRuntime, reconcile: boolean) => Promise<void>;
};
const obsolete = () =>
  new ReceiptStateError(
    '입고 대상이나 작업 상태가 바뀌었어요. 다시 확인해 주세요.'
  );

/** Only a fresh, scoped response can authorize a caller awaiting refresh(). */
export function useReceiptLineState(
  lineId: string | null,
  warehouseId: string | null,
  options: ReadOptions = {}
) {
  const api = useApiClient();
  const runtime = useWorkRuntime();
  const session = useSession();
  const authed = useIsAuthenticated();
  const qc = useQueryClient();
  const { expectedSource, beforeRead } = options;
  const identity = JSON.stringify([lineId, warehouseId, expectedSource]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const generation = useRef(0);
  const active = useRef(false);
  const phase = useRef<'idle' | 'preparing' | 'reading'>('idle');
  const cacheKey = useRef<ReturnType<typeof receiptLineStateKey> | null>(null);
  const [view, setView] = useState<{
    identity: string;
    state: ReceiptLineState | null;
    error: Error | null;
  }>({ identity, state: null, error: null });
  const load = useCallback(
    async (reconcile: boolean): Promise<ReceiptLineState> => {
      // A retained handler for a previous selection must not claim ownership
      // of the current target's generation, view, or preparation phase.
      if (!active.current || identityRef.current !== identity) throw obsolete();
      const request = ++generation.current;
      const live = () =>
        active.current &&
        generation.current === request &&
        identityRef.current === identity;
      phase.current = 'preparing';
      setView({ identity, state: null, error: null });
      try {
        if (!runtime || !session.isAuthenticated())
          throw new ReceiptStateError('로그인을 다시 확인해 주세요.');
        if (!lineId || !warehouseId)
          throw new ReceiptStateError('입고 건과 창고를 선택해 주세요.');
        const scope = await runtime.getScope();
        if (!live()) throw obsolete();
        await beforeRead?.(runtime, reconcile);
        if (!live()) throw obsolete();
        phase.current = 'reading';
        // A concurrent command may have started during capability lookup. Once
        // preparation ends, notifications supersede us even during this check.
        if (beforeRead && (await runtime.store.pending(scope)).length > 0)
          throw new ReceiptStateError(
            '처리 여부를 아직 확인하지 못했어요. 처리 내역을 다시 확인해 주세요.'
          );
        if (
          !live() ||
          !session.isAuthenticated() ||
          (await runtime.getScope()) !== scope
        )
          throw obsolete();
        if (!live()) throw obsolete();
        const key = receiptLineStateKey(scope, warehouseId, lineId);
        cacheKey.current = key;
        const value = await api.request<unknown>({
          path: `/inbound/lines/${encodeURIComponent(lineId)}/state?warehouseId=${encodeURIComponent(warehouseId)}`,
        });
        validateReceiptLineState(value, lineId, warehouseId);
        if (expectedSource && value.source !== expectedSource)
          throw new ReceiptStateError(
            '입고 구분이 바뀌었어요. 입고내역에서 다시 선택해 주세요.'
          );
        if (!live()) throw obsolete();
        // begin() is durable before the runner emits its first notification.
        // A GET can finish in that interval, so notifications alone are not
        // enough to authorize another action.
        if (beforeRead && (await runtime.store.pending(scope)).length > 0)
          throw new ReceiptStateError(
            '처리 여부를 아직 확인하지 못했어요. 처리 내역을 다시 확인해 주세요.'
          );
        if (
          !live() ||
          !session.isAuthenticated() ||
          (await runtime.getScope()) !== scope
        )
          throw obsolete();
        if (!live()) throw obsolete();
        qc.setQueryData(key, value);
        setView({ identity, state: value, error: null });
        return value;
      } catch (failure) {
        const error =
          failure instanceof Error
            ? failure
            : new ReceiptStateError('입고 상태를 다시 확인해 주세요.');
        if (live()) setView({ identity, state: null, error });
        throw error;
      } finally {
        if (live()) phase.current = 'idle';
      }
    },
    [
      api,
      runtime,
      session,
      qc,
      identity,
      lineId,
      warehouseId,
      expectedSource,
      beforeRead,
    ]
  );
  useEffect(() => {
    active.current = true;
    const start = (reconcile: boolean) => {
      if (lineId && warehouseId) void load(reconcile).catch(() => {});
    };
    const unsubscribeSession = session.subscribe(() => {
      ++generation.current;
      setView({ identity, state: null, error: null });
      start(true);
    });
    const unsubscribeOperations = runtime?.runner.subscribe(() => {
      if (cacheKey.current)
        void qc.invalidateQueries({
          queryKey: cacheKey.current,
          exact: true,
          refetchType: 'none',
        });
      // retryPending emits even for an empty queue. Preparation checks the queue
      // again before GET, so its own notifications cannot supersede its promise.
      if (phase.current === 'preparing') return;
      start(false);
    });
    start(true);
    return () => {
      active.current = false;
      ++generation.current;
      unsubscribeSession();
      unsubscribeOperations?.();
    };
  }, [load, runtime, session, qc, lineId, warehouseId, identity]);
  const visible = view.identity === identity && authed;
  return {
    state: visible ? view.state : null,
    ready: visible && view.state !== null,
    error: visible ? view.error : null,
    refresh: useCallback(() => load(true), [load]),
  };
}
