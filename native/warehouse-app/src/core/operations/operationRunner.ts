import { validateOperationResult } from './operationResult';
import { recordDiagnostic } from '../diagnostics/operationDiagnostics';
import { ApiError, type ApiClient } from '../data/httpClient';
import { type OperationStore, type StoredOperation } from './operationStore';
type Request = Parameters<ApiClient['request']>[0];
const ledgerPath =
  /^(\/inbound\/(simple|putaway|cancel)$|\/movement\/move$|\/inventory\/stocks\/adjust$|\/purchase-orders\/[^/]+\/receipts$|\/purchase-orders\/receipt-lines\/[^/]+\/cancel$|\/shipments\/[^/]+\/(simple-outbound-(scans|forces)|location-outbound-(starts|scans|forces))$|\/stocktaking\/(scan-product|scan-location|count-items)$|\/stocktaking\/lines\/[^/]+\/(count|reset-count)$|\/stocktaking\/sessions\/[^/]+\/complete$)/;
function resource(path: string, body: Record<string, unknown>) {
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
        : w.reject(new ApiError('작업이 반영되지 않았어요.', 400, op.errorCode))
    );
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
            failure.outcome === 'rejected'
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
          ownership
        );
        const saved = (await deps.store.get(input.id))!;
        recordDiagnostic(saved);
        if (status === 'confirmed') deps.onConfirmed?.();
        await settle(saved).catch(() => {});
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
    });
    if (op.status === 'confirmed') return op.result as T;
    if (op.status === 'rejected')
      throw new ApiError('작업이 반영되지 않았어요.', 400, op.errorCode);
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
