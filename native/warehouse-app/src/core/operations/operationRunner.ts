import { validateOperationResult } from './operationResult';
import { forgetScanDraft } from './boxChecks';
const SIMPLE_SCAN_PATH = /^\/shipments\/([^/]+)\/simple-outbound-scans$/;
import { recordDiagnostic } from '../diagnostics/operationDiagnostics';
import { ApiError, type ApiClient } from '../data/httpClient';
import { type OperationStore, type StoredOperation } from './operationStore';
type Request = Parameters<ApiClient['request']>[0];
const ledgerPath =
  /^(\/inbound\/(simple|putaway|cancel)$|\/movement\/move$|\/inventory\/stocks\/adjust$|\/purchase-orders\/[^/]+\/receipts$|\/purchase-orders\/receipt-lines\/[^/]+\/cancel$|\/shipments\/[^/]+\/(simple-outbound-(scans|forces)|location-outbound-(starts|scans|forces))$|\/stocktaking\/(scan-product|scan-location|count-items)$|\/stocktaking\/lines\/[^/]+\/(count|reset-count)$|\/stocktaking\/sessions\/[^/]+\/complete$|\/inventory\/inbound-shipments\/[^/]+\/boxes(\/[^/]+\/receive(\/cancel)?)?$)/;
function resource(path: string, body: Record<string, unknown>) {
  const shipmentBox =
    /^\/inventory\/inbound-shipments\/([^/]+)\/boxes\/([^/]+)\//.exec(path);
  if (shipmentBox) return `inbound-shipment-box:${shipmentBox[2]}`;
  const shipment = /^\/inventory\/inbound-shipments\/([^/]+)\/boxes$/.exec(
    path
  );
  if (shipment) return `inbound-shipment:${shipment[1]}`;
  if (path.startsWith('/shipments/'))
    return path.split('/').slice(0, 3).join('/');
  if (path.startsWith('/stocktaking/'))
    return `stocktaking:${body.sessionId ?? path.split('/')[3]}`;
  if (path.startsWith('/purchase-orders/'))
    return path.split('/').slice(0, 3).join('/');
  if (body.lineId) return `receipt:${body.lineId}`;
  if (path.endsWith('/adjust'))
    return `adjust:${body.skuId}:${body.locationId}`;
  return `${path}:${body.warehouseId}`;
}
/** 저장된 거절을 화면에 돌려줄 오류로 다시 만든다 — 경로가 있어야 출고 저장 경로의 거절로 읽힌다. */
export function storedRejection(op: StoredOperation) {
  return new ApiError(
    '작업이 반영되지 않았어요.',
    op.errorStatus ?? 400,
    op.errorCode,
    op.preparation,
    undefined,
    op.requiredPermissions,
    undefined,
    op.path,
    op.rejectionRecorded,
    op.scannedSkuName
  );
}
export function createOperationRunner(deps: {
  api: ApiClient;
  store: OperationStore;
  getScope: () => Promise<string>;
  assertPrincipal?: (token: string, scope: string) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
  onConfirmed?: () => void;
}) {
  const ownerId = crypto.randomUUID();
  const listeners = new Set<() => void>();
  const wait =
    deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let snapshot: StoredOperation[] = [];
  const flights = new Map<string, Promise<void>>();
  const waiting = new Map<
    string,
    Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }>
  >();
  const notify = async () => {
    snapshot = await deps.store.pending(await deps.getScope());
    listeners.forEach((f) => f());
  };
  async function settle(op: StoredOperation) {
    if (!['confirmed', 'rejected'].includes(op.status)) return;
    // A response belonging to the previous account cannot update the new account's screen.
    if (op.scope !== (await deps.getScope())) return;
    const callbacks = waiting.get(op.id);
    waiting.delete(op.id);
    callbacks?.forEach((w) =>
      op.status === 'confirmed'
        ? w.resolve(op.result)
        : w.reject(storedRejection(op))
    );
  }
  /** 결과가 정해진 스캔은 그 박스의 저장된 입력에서 뺀다 — 박스를 닫은 사이 확인됐으면 다시 열 때 옛 응답을 재생하지 않게 */
  async function forgetSettledScan(op: StoredOperation) {
    // 위치 확인 출고는 현재 상태 조회가 확인할 때까지 머리를 남기는 설계라 건드리지 않는다
    const box = SIMPLE_SCAN_PATH.exec(op.path)?.[1];
    if (box)
      await forgetScanDraft(deps.store, op.scope, box, op.id).catch(() => {});
  }
  async function execute(input: StoredOperation) {
    if (flights.has(input.id)) return flights.get(input.id);
    const flight = (async () => {
      if (
        input.scope !== (await deps.getScope()) ||
        Date.now() - input.createdAt >= 29 * 86400000
      )
        return;
      for (let attempt = 0; attempt < 4; attempt++) {
        const latest = await deps.store.get(input.id);
        if (!latest) return;
        if (['confirmed', 'rejected'].includes(latest.status)) {
          await settle(latest);
          await forgetSettledScan(latest);
          await notify();
          return;
        }
        if (
          !(await deps.store.claim(input.id, await deps.getScope(), ownerId))
        ) {
          observe();
          return;
        }
        const claimed = await deps.store.get(input.id);
        if (!claimed || claimed.ownerId !== ownerId) return;
        const locationForce =
          /^\/shipments\/[^/]+\/location-outbound-forces$/.test(input.path);
        // A saved sending/uncertain force may already have committed. Only the
        // resolver can close that command without executing it again.
        const resolving =
          locationForce &&
          (claimed.status !== 'queued' || claimed.attempts > 0);
        const ownership = locationForce
          ? { scope: input.scope, ownerId }
          : undefined;
        await deps.store.finish(
          input.id,
          'sending',
          undefined,
          undefined,
          ownership
        );
        await notify();
        let result: unknown;
        let failure: unknown;
        let forceRejected = false;
        try {
          result = await deps.api.request({
            method: input.method,
            path: resolving
              ? input.path.replace(
                  /location-outbound-forces$/,
                  'location-outbound-force-resolutions'
                )
              : input.path,
            body: JSON.parse(input.bodyJson),
            idempotencyKey: input.id,
            bodyJson: input.bodyJson,
            beforeSend: async (token) => {
              if (input.scope !== (await deps.getScope()))
                throw new Error('로그인을 다시 확인해 주세요.');
              await deps.assertPrincipal?.(token, input.scope);
            },
          });
          if (resolving) {
            const resolution = result as {
              outcome?: unknown;
              result?: unknown;
              code?: unknown;
            } | null;
            if (
              !resolution ||
              typeof resolution !== 'object' ||
              Array.isArray(resolution)
            )
              throw new TypeError('처리 결과를 확인하지 못했어요.');
            if (
              resolution.outcome === 'rejected' &&
              resolution.code === 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED'
            ) {
              forceRejected = true;
              result = undefined;
            } else if (resolution.outcome === 'confirmed') {
              result = resolution.result;
              validateOperationResult(
                input.path,
                result,
                JSON.parse(input.bodyJson)
              );
            } else throw new TypeError('처리 결과를 확인하지 못했어요.');
          } else {
            validateOperationResult(
              input.path,
              result,
              JSON.parse(input.bodyJson)
            );
          }
          if (locationForce && input.scope !== (await deps.getScope()))
            throw new Error('로그인을 다시 확인해 주세요.');
        } catch (error) {
          failure = error;
        }
        // Persistence/notification errors after a response must never change its outcome.
        const status = failure
          ? !resolving &&
            failure instanceof ApiError &&
            failure.outcome === 'rejected' &&
            !(
              failure.status === 403 &&
              (claimed.attempts > 0 || claimed.status !== 'queued')
            )
            ? 'rejected'
            : 'uncertain'
          : forceRejected
            ? 'rejected'
            : 'confirmed';
        await deps.store.finish(
          input.id,
          status,
          result,
          !failure && forceRejected
            ? 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED'
            : failure instanceof ApiError
              ? failure.code
              : undefined,
          ownership,
          failure instanceof ApiError ? failure.preparation : undefined,
          failure instanceof ApiError ? failure.requiredPermissions : undefined,
          failure instanceof ApiError ? failure.status : undefined,
          failure instanceof ApiError && failure.rejectionRecorded,
          failure instanceof ApiError ? failure.scannedSkuName : undefined
        );
        const saved = (await deps.store.get(input.id))!;
        recordDiagnostic(saved);
        if (status === 'confirmed') deps.onConfirmed?.();
        await settle(saved).catch(() => {});
        // 첫 시도에 정해진 결과는 화면의 큐가 지운다 — 다시 보낸 것만(그 사이 박스를 닫았을 수 있다)
        if (
          status !== 'uncertain' &&
          (claimed.attempts > 0 || claimed.status !== 'queued')
        )
          await forgetSettledScan(saved);
        await notify().catch(() => {});
        if (locationForce && !resolving && status === 'uncertain') {
          if (input.scope !== (await deps.getScope())) return;
          continue;
        }
        if (
          status !== 'uncertain' ||
          resolving ||
          attempt === 3 ||
          (failure instanceof ApiError && !failure.retryable)
        )
          return;
        await wait(1000 * 2 ** attempt);
        if (input.scope !== (await deps.getScope())) return;
      }
    })().finally(async () => {
      flights.delete(input.id);
      await deps.store.release(input.id, ownerId);
    });
    flights.set(input.id, flight);
    return flight;
  }
  async function reconcileWaiting() {
    for (const id of waiting.keys()) {
      const op = await deps.store.get(id);
      if (op) {
        await settle(op);
        if (op.status === 'sending' && (op.leaseExpiresAt ?? 0) <= Date.now())
          void execute(op).catch(() => {});
      }
    }
  }
  // Other windows can complete the same operation. Observe its terminal record even
  // though it no longer appears in pending(). Do not issue unlimited automatic retries.
  let observer: ReturnType<typeof setTimeout> | undefined;
  function observe() {
    if (observer || !waiting.size) return;
    observer = setTimeout(() => {
      observer = undefined;
      void reconcileWaiting()
        .catch(() => {})
        .finally(observe);
    }, 1000);
  }
  const request: ApiClient['request'] = async <T>(o: Request): Promise<T> => {
    if ((o.method ?? 'GET') === 'GET' || !ledgerPath.test(o.path))
      return deps.api.request<T>(o);
    const scope = await deps.getScope();
    const id = o.idempotencyKey ?? crypto.randomUUID();
    const raw = (o.body ?? {}) as Record<string, unknown>;
    const body = o.path.startsWith('/shipments/')
      ? raw
      : { ...raw, contractVersion: 2, idempotencyKey: id };
    const op = await deps.store.begin({
      id,
      scope,
      resource: resource(o.path, body),
      path: o.path,
      method: o.method ?? 'POST',
      bodyJson: JSON.stringify(body),
      createdAt: Date.now(),
      ...(o.summary ? { summary: o.summary } : {}),
      ...(o.screen ? { screen: o.screen } : {}),
    });
    if (op.status === 'confirmed') return op.result as T;
    if (op.status === 'rejected') throw storedRejection(op);
    return new Promise<T>((resolve, reject) => {
      const list = waiting.get(id) ?? [];
      list.push({ resolve: (v) => resolve(v as T), reject });
      waiting.set(id, list);
      void execute(op).catch(() => {
        void notify().catch(() => {});
      });
    });
  };
  return {
    request,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSnapshot: () => snapshot,
    async restore() {
      for (const op of await deps.store.pending(await deps.getScope())) {
        if (op.status === 'sending' && (op.leaseExpiresAt ?? 0) <= Date.now())
          await deps.store.finish(op.id, 'uncertain');
      }
      await notify();
    },
    /** 고른 작업만 같은 키로 다시 맞춘다(확인할 일 목록). 끝난 뒤의 기록을 돌려준다 */
    async recheck(ids: readonly string[]) {
      const scope = await deps.getScope();
      for (const id of ids) {
        const op = await deps.store.get(id);
        if (op && op.scope === scope) await execute(op);
      }
      await reconcileWaiting();
      await notify();
      const after = await Promise.all(ids.map((id) => deps.store.get(id)));
      return after.filter((op): op is StoredOperation => op !== null);
    },
    async retryPending() {
      await reconcileWaiting();
      for (const op of await deps.store.pending(await deps.getScope()))
        await execute(op);
      await reconcileWaiting();
      await notify();
    },
  };
}
export type OperationRunner = ReturnType<typeof createOperationRunner>;
