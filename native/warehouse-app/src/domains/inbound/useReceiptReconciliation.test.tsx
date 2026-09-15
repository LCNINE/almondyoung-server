import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ApiError, type ApiClient } from '../../core/data/httpClient';
import {
  OperationContext,
  type WorkRuntime,
} from '../../core/operations/OperationContext';
import { createOperationRunner } from '../../core/operations/operationRunner';
import { createOperationStore } from '../../core/operations/operationStore';
import { useReceiptReconciliation } from './useReceiptReconciliation';

const current = {
  lineId: 'line',
  receiptId: 'receipt',
  warehouseId: 'warehouse',
  source: 'direct',
  receiptStatus: 'posted',
  skuId: 'sku',
  skuCode: 'SKU',
  skuName: '상품',
  originLocationId: 'origin',
  originLocationCode: 'INBOUND',
  quantity: 5,
  putawayFromOriginQty: 0,
  canceledQty: 0,
  returnedQty: 0,
  pendingQty: 5,
  canPutaway: true,
  putawayBlockReason: null,
  canCancel: true,
  cancelBlockReason: null,
} as const;
const canceled = {
  ...current,
  canceledQty: 5,
  pendingQty: 0,
  receiptStatus: 'voided',
  canCancel: false,
  canPutaway: false,
  cancelBlockReason: 'CANCELED',
  putawayBlockReason: 'CANCELED',
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const listeners = new Set<() => void>();
  let authed = true;
  let scope = 'actor|server';
  let read: () => Promise<unknown> = async () => current;
  let write: (
    request: Parameters<ApiClient['request']>[0]
  ) => Promise<unknown> = async () => ({ success: true });
  const sent: Parameters<ApiClient['request']>[0][] = [];
  const api: ApiClient = {
    request: async <T,>(request: Parameters<ApiClient['request']>[0]) => {
      sent.push(request);
      return (await ((request.method ?? 'GET') === 'GET'
        ? read()
        : write(request))) as T;
    },
  };
  const session = {
    bootstrap: async () => {},
    isAuthenticated: () => authed,
    getAccessToken: async () => 'token',
    login: async () => {},
    logout: async () => {},
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  const store = createOperationStore(crypto.randomUUID());
  const getScope = async () => {
    if (!authed) throw new Error('로그인이 필요해요.');
    return scope;
  };
  const runner = createOperationRunner({
    api,
    store,
    getScope,
    wait: async () => {},
  });
  const runtime: WorkRuntime = {
    runner,
    store,
    getScope,
    getCapabilities: async () => ({ inboundWorkflowConsistency: true }),
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={runner}>
          <OperationContext.Provider value={runtime}>
            {children}
          </OperationContext.Provider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  const mount = () =>
    renderHook((props) => useReceiptReconciliation(props), {
      wrapper,
      initialProps: {
        lineId: 'line',
        warehouseId: 'warehouse',
        expectedSource: 'direct' as 'direct' | 'purchase_order',
      },
    });
  const save = async () => {
    const bodyJson =
      '{"lineId":"line","quantity":5,"contractVersion":2,"idempotencyKey":"original"}';
    await store.begin({
      id: 'original',
      scope,
      resource: 'receipt:line',
      method: 'POST',
      path: '/inbound/cancel',
      bodyJson,
      createdAt: Date.now(),
    });
    await store.finish('original', 'uncertain');
    await store.draft('draft', () => ({ quantity: '5', lineId: 'line' }));
    return bodyJson;
  };
  return {
    mount,
    store,
    runner,
    runtime,
    sent,
    qc,
    save,
    read: (fn: typeof read) => {
      read = fn;
    },
    write: (fn: typeof write) => {
      write = fn;
    },
    scope: (value: string, emit = true) => {
      scope = value;
      if (emit) listeners.forEach((fn) => fn());
    },
    auth: (value: boolean) => {
      authed = value;
      listeners.forEach((fn) => fn());
    },
  };
}
const gets = (f: ReturnType<typeof fixture>) =>
  f.sent.filter((r) => !r.method || r.method === 'GET');

it('reads current state with scope identity and a refresh completes without an empty retry loop', async () => {
  const f = fixture();
  const { result } = f.mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(
    f.qc.getQueryData([
      'inbound-receipt-state',
      'actor|server',
      'warehouse',
      'line',
    ])
  ).toEqual(current);
  await act(async () => {
    expect(await result.current.refresh()).toEqual(current);
  });
  expect(gets(f)).toHaveLength(2);
  expect(gets(f)[0].path).toBe(
    '/inbound/lines/line/state?warehouseId=warehouse'
  );
});
it('rejects an obsolete refresh and never restores the pre-cancel GET', async () => {
  const f = fixture();
  const { result } = f.mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  const old = deferred<unknown>();
  f.read(() => old.promise);
  let obsolete!: Promise<unknown>;
  act(() => {
    obsolete = result.current.refresh().catch((e: unknown) => e);
  });
  await waitFor(() => expect(gets(f)).toHaveLength(2));
  f.read(async () => canceled);
  await act(async () => {
    await f.runner.request({
      method: 'POST',
      path: '/inbound/cancel',
      body: { lineId: 'line' },
      idempotencyKey: 'cancel',
    });
  });
  await waitFor(() => expect(result.current.state).toEqual(canceled));
  await act(async () => {
    old.resolve(current);
    expect(await obsolete).toBeInstanceOf(Error);
  });
  expect(result.current.state).toEqual(canceled);
});
it('reconciles lost success using the original key/body before reading cancellation, retaining input', async () => {
  const f = fixture();
  const body = await f.save();
  const applied = new Set<string>();
  let applications = 0;
  f.write(async (request) => {
    if (!applied.has(request.idempotencyKey!)) {
      applied.add(request.idempotencyKey!);
      applications++;
      throw new TypeError('lost response');
    }
    return { success: true };
  });
  f.read(async () => canceled);
  const { result } = f.mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.state).toEqual(canceled);
  expect((await f.store.get('original'))?.status).toBe('confirmed');
  expect(applications).toBe(1);
  expect(
    f.sent
      .filter((r) => r.method === 'POST')
      .map((r) => [r.idempotencyKey, r.bodyJson])
  ).toEqual([
    ['original', body],
    ['original', body],
  ]);
  expect(await f.store.draft('draft')).toEqual({
    quantity: '5',
    lineId: 'line',
  });
});
it('settles a previously unknown rejection before the old capability gate', async () => {
  const f = fixture();
  await f.save();
  f.runtime.getCapabilities = undefined;
  f.write(async () => {
    throw new ApiError('protected', 409, 'INBOUND_ORIGIN_STOCK_PROTECTED');
  });
  const { result } = f.mount();
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect((await f.store.get('original'))?.status).toBe('rejected');
  expect(result.current.ready).toBe(false);
  expect(gets(f)).toHaveLength(0);
});
it('keeps uncertain requests blocked with the original intent until explicit retry succeeds', async () => {
  const f = fixture();
  const body = await f.save();
  f.write(async () => {
    throw new ApiError('unknown', 409, 'UNKNOWN');
  });
  const { result } = f.mount();
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(gets(f)).toHaveLength(0);
  expect(result.current.ready).toBe(false);
  expect((await f.store.get('original'))?.bodyJson).toBe(body);
  f.write(async () => ({ success: true }));
  f.read(async () => canceled);
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.state).toEqual(canceled);
});
it.each([
  null,
  { ...current, source: 'purchase_order' },
  { ...current, warehouseId: 'other' },
  new ApiError('missing', 404),
  new ApiError('forbidden', 403),
])(
  'blocks invalid state or read failure and supports retry %#',
  async (failure) => {
    const f = fixture();
    f.read(async () => {
      if (failure instanceof Error) throw failure;
      return failure;
    });
    const { result } = f.mount();
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.state).toBeNull();
    expect(result.current.ready).toBe(false);
    f.read(async () => current);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.ready).toBe(true);
  }
);
it('blocks a confirmed cancellation whose current-state read fails and retains the draft', async () => {
  const f = fixture();
  await f.save();
  f.read(async () => {
    throw new Error('offline');
  });
  const { result } = f.mount();
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect((await f.store.get('original'))?.status).toBe('confirmed');
  expect(result.current.state).toBeNull();
  expect(result.current.ready).toBe(false);
  expect(await f.store.draft('draft')).toEqual({
    quantity: '5',
    lineId: 'line',
  });
});
it('blocks storage failure and recovers without losing input', async () => {
  const f = fixture();
  await f.save();
  const finish = vi
    .spyOn(f.store, 'finish')
    .mockRejectedValue(new Error('disk full'));
  const { result } = f.mount();
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(result.current.ready).toBe(false);
  expect(gets(f)).toHaveLength(0);
  finish.mockRestore();
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.ready).toBe(true);
  expect(await f.store.draft('draft')).toEqual({
    quantity: '5',
    lineId: 'line',
  });
});
it('rejects refresh on silent scope change, then reloads for relogin on the same runtime', async () => {
  const f = fixture();
  const { result } = f.mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  const old = deferred<unknown>();
  f.read(() => old.promise);
  let promise!: Promise<unknown>;
  act(() => {
    promise = result.current.refresh().catch((e: unknown) => e);
  });
  await waitFor(() => expect(gets(f)).toHaveLength(2));
  f.scope('other', false);
  await act(async () => {
    old.resolve(current);
    expect(await promise).toBeInstanceOf(Error);
  });
  expect(result.current.ready).toBe(false);
  f.read(async () => current);
  act(() => f.scope('other'));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(
    f.qc.getQueryData(['inbound-receipt-state', 'other', 'warehouse', 'line'])
  ).toEqual(current);
  act(() => f.auth(false));
  await waitFor(() => expect(result.current.ready).toBe(false));
});
it('rejects a target change refresh and does not apply the previous line response', async () => {
  const f = fixture();
  const { result, rerender } = f.mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  const old = deferred<unknown>();
  f.read(() => old.promise);
  let promise!: Promise<unknown>;
  act(() => {
    promise = result.current.refresh().catch((e: unknown) => e);
  });
  await waitFor(() => expect(gets(f)).toHaveLength(2));
  f.read(async () => ({
    ...current,
    lineId: 'next',
    warehouseId: 'next-warehouse',
  }));
  rerender({
    lineId: 'next',
    warehouseId: 'next-warehouse',
    expectedSource: 'direct',
  });
  await waitFor(() => expect(result.current.state?.lineId).toBe('next'));
  await act(async () => {
    old.resolve(current);
    expect(await promise).toBeInstanceOf(Error);
  });
  expect(result.current.state?.lineId).toBe('next');
});

it('does not miss a new pending operation while the capability read is delayed', async () => {
  const f = fixture();
  const capabilities = deferred<{ inboundWorkflowConsistency: boolean }>();
  const started = deferred<void>();
  f.runtime.getCapabilities = () => {
    started.resolve();
    return capabilities.promise;
  };
  const { result } = f.mount();
  await act(async () => {
    await started.promise;
  });
  await f.save();
  await act(async () => {
    await f.runner.restore();
  });
  await act(async () => {
    capabilities.resolve({ inboundWorkflowConsistency: true });
  });
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(result.current.ready).toBe(false);
  expect(gets(f)).toHaveLength(0);
});
it('blocks new work when capability is absent, false or malformed and allows explicit upgrade retry', async () => {
  const f = fixture();
  f.runtime.getCapabilities = async () => ({});
  const { result } = f.mount();
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(gets(f)).toHaveLength(0);
  f.runtime.getCapabilities = async () => ({
    inboundWorkflowConsistency: false,
  });
  await act(async () => {
    await expect(result.current.refresh()).rejects.toThrow(/업데이트/);
  });
  f.runtime.getCapabilities = async () => ({
    inboundWorkflowConsistency: true,
  });
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.ready).toBe(true);
});

it('uses current GET instead of an already-confirmed historical receipt response', async () => {
  const f = fixture();
  await f.store.begin({
    id: 'receipt-command',
    scope: 'actor|server',
    resource: '/inbound/simple:warehouse',
    method: 'POST',
    path: '/inbound/simple',
    bodyJson: '{}',
    createdAt: Date.now(),
  });
  await f.store.finish('receipt-command', 'confirmed', {
    id: 'receipt',
    lines: [{ id: 'line', skuId: 'sku', quantity: 5 }],
  });
  f.read(async () => canceled);
  const { result } = f.mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.state).toEqual(canceled);
  expect(f.sent).toHaveLength(1);
});
it('rejects capability/auth lookup failures before reading and recovers after login', async () => {
  const f = fixture();
  f.runtime.getScope = async () => {
    throw new ApiError('unauthorized', 401);
  };
  const { result } = f.mount();
  await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
  expect(result.current.ready).toBe(false);
  expect(gets(f)).toHaveLength(0);
  f.runtime.getScope = async () => 'actor|server';
  f.runtime.getCapabilities = async () => {
    throw new ApiError('forbidden', 403);
  };
  await act(async () => {
    await expect(result.current.refresh()).rejects.toMatchObject({
      status: 403,
    });
  });
  expect(gets(f)).toHaveLength(0);
  f.runtime.getCapabilities = async () => ({
    inboundWorkflowConsistency: true,
  });
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.ready).toBe(true);
});

it('rejects a retained old-target refresh without disturbing the ready target or its operation notifications', async () => {
  const f = fixture();
  const { result, rerender } = f.mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  const previousRefresh = result.current.refresh;
  const next = { ...current, lineId: 'next' };
  f.read(async () => next);
  rerender({
    lineId: 'next',
    warehouseId: 'warehouse',
    expectedSource: 'direct',
  });
  await waitFor(() => expect(result.current.state).toEqual(next));

  await act(async () => {
    await expect(previousRefresh()).rejects.toThrow(/바뀌었어요/);
  });
  expect(result.current.ready).toBe(true);
  expect(result.current.state).toEqual(next);

  const nextCanceled = { ...canceled, lineId: 'next' };
  f.read(async () => nextCanceled);
  await act(async () => {
    await f.runner.request({
      method: 'POST',
      path: '/inbound/cancel',
      body: { lineId: 'next' },
      idempotencyKey: 'next-cancel',
    });
  });
  await waitFor(() => expect(result.current.state).toEqual(nextCanceled));
  expect(result.current.ready).toBe(true);
});

it('rejects a state GET completed after durable enqueue but before the first runner notification', async () => {
  const f = fixture();
  const { result } = f.mount();
  await waitFor(() => expect(result.current.ready).toBe(true));
  const response = deferred<unknown>();
  f.read(() => response.promise);
  let refreshed!: Promise<unknown>;
  act(() => {
    refreshed = result.current.refresh().catch((error: unknown) => error);
  });
  await waitFor(() => expect(gets(f)).toHaveLength(2));

  const claimStarted = deferred<void>();
  const releaseClaim = deferred<void>();
  const originalClaim = f.store.claim;
  const claim = vi
    .spyOn(f.store, 'claim')
    .mockImplementation(async (...args) => {
      claimStarted.resolve();
      await releaseClaim.promise;
      return originalClaim(...args);
    });
  let command!: Promise<unknown>;
  await act(async () => {
    command = f.runner.request({
      method: 'POST',
      path: '/inbound/cancel',
      body: { lineId: 'line' },
      idempotencyKey: 'queued-during-get',
    });
    await claimStarted.promise;
  });
  try {
    expect((await f.store.get('queued-during-get'))?.status).toBe('queued');
    expect(f.runner.getSnapshot()).toEqual([]);
    expect(f.sent.filter((request) => request.method === 'POST')).toHaveLength(
      0
    );
    await act(async () => {
      response.resolve(current);
      expect(await refreshed).toBeInstanceOf(Error);
    });
    expect(result.current.ready).toBe(false);
    expect(result.current.state).toBeNull();
  } finally {
    f.read(async () => canceled);
    await act(async () => {
      releaseClaim.resolve();
      await command;
    });
    claim.mockRestore();
  }
  await waitFor(() => expect(result.current.state).toEqual(canceled));
  expect(result.current.ready).toBe(true);
});
