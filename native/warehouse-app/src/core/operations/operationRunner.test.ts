import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { createOperationStore } from './operationStore';
import { createOperationRunner } from './operationRunner';
import type { ApiClient } from '../data/httpClient';

describe('durable requests', () => {
  it('replays same operation after commit and lost response without applying twice', async () => {
    const applied = new Map<string, unknown>();
    let stock = 0;
    const sent: string[] = [];
    const api: ApiClient = {
      request: async <T>(o: Parameters<ApiClient['request']>[0]) => {
        sent.push(o.idempotencyKey!);
        if (!applied.has(o.idempotencyKey!)) {
          stock += 2;
          applied.set(o.idempotencyKey!, { stock });
          throw new TypeError('lost response');
        }
        return applied.get(o.idempotencyKey!) as T;
      },
    };
    const runner = createOperationRunner({
      api,
      store: createOperationStore(crypto.randomUUID()),
      getScope: async () => 'actor|server',
      wait: async () => {},
    });
    const result = await runner.request({
      method: 'POST',
      path: '/inventory/stocks/adjust',
      body: {
        skuId: 's',
        warehouseId: 'w',
        locationId: 'l',
        delta: 2,
        reason: 'found',
      },
      idempotencyKey: 'one',
    });
    expect(result).toEqual({ stock: 2 });
    expect(stock).toBe(2);
    expect(sent).toEqual(['one', 'one']);
  });
  it('storage failure prevents sending', async () => {
    const api: ApiClient = { request: vi.fn() };
    const store = createOperationStore(crypto.randomUUID());
    vi.spyOn(store, 'begin').mockRejectedValue(new Error('disk full'));
    const runner = createOperationRunner({
      api,
      store,
      getScope: async () => 'a',
      wait: async () => {},
    });
    await expect(
      runner.request({
        method: 'POST',
        path: '/movement/move',
        body: { warehouseId: 'w' },
        idempotencyKey: 'x',
      })
    ).rejects.toThrow('disk full');
    expect(api.request).not.toHaveBeenCalled();
  });
  it('old unresolved work is preserved without automatic replay', async () => {
    const store = createOperationStore(crypto.randomUUID());
    await store.begin({
      id: 'old',
      scope: 'a',
      resource: 'adjust:s:l',
      method: 'POST',
      path: '/inventory/stocks/adjust',
      bodyJson: '{}',
      createdAt: Date.now() - 30 * 86400000,
    });
    const api: ApiClient = { request: vi.fn() };
    const runner = createOperationRunner({
      api,
      store,
      getScope: async () => 'a',
      wait: async () => {},
    });
    await runner.retryPending();
    expect(api.request).not.toHaveBeenCalled();
    expect(await store.pending('a')).toHaveLength(1);
  });
});

it('settles a second window from the terminal record even after it leaves pending', async () => {
  const name = crypto.randomUUID(),
    storeA = createOperationStore(name),
    storeB = createOperationStore(name);
  let release!: (v: unknown) => void;
  const api: ApiClient = {
    request: vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    ) as ApiClient['request'],
  };
  const a = createOperationRunner({
      api,
      store: storeA,
      getScope: async () => 'a',
    }),
    b = createOperationRunner({
      api,
      store: storeB,
      getScope: async () => 'a',
    });
  const request = {
    method: 'POST',
    path: '/inventory/stocks/adjust',
    body: { delta: 1 },
    idempotencyKey: 'same',
  };
  const first = a.request(request);
  await vi.waitFor(() => expect(api.request).toHaveBeenCalledTimes(1));
  const second = b.request(request);
  await vi.waitFor(async () =>
    expect((await storeB.get('same'))?.status).toBe('sending')
  );
  release({ ok: true });
  await expect(first).resolves.toEqual({ ok: true });
  await b.retryPending();
  await expect(second).resolves.toEqual({ ok: true });
  expect(api.request).toHaveBeenCalledTimes(1);
});
it('never downgrades confirmed work after the account disappears during notification', async () => {
  const store = createOperationStore(crypto.randomUUID());
  let lost = false;
  const finish = store.finish;
  vi.spyOn(store, 'finish').mockImplementation(async (...args) => {
    await finish(...args);
    if (args[1] === 'confirmed') lost = true;
  });
  const runner = createOperationRunner({
    store,
    getScope: async () => {
      if (lost) throw new Error('logged out');
      return 'a';
    },
    api: { request: async <T>() => ({ ok: true }) as T },
  });
  void runner.request({
    method: 'POST',
    path: '/inventory/stocks/adjust',
    body: { delta: 1 },
    idempotencyKey: 'x',
  });
  await vi.waitFor(async () =>
    expect((await store.get('x'))?.status).toBe('confirmed')
  );
  await store.finish('x', 'uncertain');
  expect((await store.get('x'))?.result).toEqual({ ok: true });
});
it('binds the token at transport to the persisted actor before any write', async () => {
  const store = createOperationStore(crypto.randomUUID());
  let actor = 'a';
  let sent = 0;
  const finish = store.finish;
  vi.spyOn(store, 'finish').mockImplementation(async (...args) => {
    await finish(...args);
    if (args[1] === 'sending') actor = 'b';
  });
  const runner = createOperationRunner({
    store,
    getScope: async () => actor,
    assertPrincipal: async (token, scope) => {
      if (token !== scope) throw new Error('account changed');
    },
    api: {
      request: async <T>(opts: Parameters<ApiClient['request']>[0]) => {
        await opts.beforeSend?.(actor);
        sent++;
        return {} as T;
      },
    },
    wait: async () => {},
  });
  void runner.request({
    method: 'POST',
    path: '/inventory/stocks/adjust',
    body: { delta: 1 },
    idempotencyKey: 'x',
  });
  await vi.waitFor(async () =>
    expect((await store.get('x'))?.status).toBe('uncertain')
  );
  expect(sent).toBe(0);
  expect((await store.get('x'))?.scope).toBe('a');
});
