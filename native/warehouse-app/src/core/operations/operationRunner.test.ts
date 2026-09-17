import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { createOperationStore } from './operationStore';
import { createOperationRunner } from './operationRunner';
import { ApiError, type ApiClient } from '../data/httpClient';
import { errorMessage } from '../data/errorMessage';

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

it('위치 출고의 마지막 응답 유실은 같은 위치·본문·키로 재확인한다', async () => {
  const store = createOperationStore(crypto.randomUUID());
  const sent: Array<{ path: string; key?: string; body?: string }> = [];
  const applied = new Set<string>();
  let picked = 0;
  const state = {
    shipmentId: 's',
    warehouseId: 'w',
    status: 'shipped',
    workItemStatus: 'completed',
    dispatchAttemptId: 'dispatch',
    lines: [
      {
        shipmentLineId: 'l',
        skuId: 'sku',
        qty: 2,
        pickedQty: 2,
        inspectedQty: 2,
      },
    ],
    sources: [],
  };
  const api: ApiClient = {
    request: async <T>(input: Parameters<ApiClient['request']>[0]) => {
      sent.push({
        path: input.path,
        key: input.idempotencyKey,
        body: input.bodyJson,
      });
      if (!applied.has(input.idempotencyKey!)) {
        applied.add(input.idempotencyKey!);
        picked += 2;
        throw new TypeError('lost response');
      }
      return state as T;
    },
  };
  const runner = createOperationRunner({
    api,
    store,
    getScope: async () => 'scope',
    wait: async () => {},
  });
  const body = {
    warehouseId: 'w',
    sourceLocationId: 'B',
    barcode: '8801',
    quantity: 2,
  };
  await expect(
    runner.request({
      method: 'POST',
      path: '/shipments/s/location-outbound-scans',
      body,
      idempotencyKey: 'same',
    })
  ).resolves.toEqual(state);
  expect(picked).toBe(2);
  expect(sent).toEqual([
    {
      path: '/shipments/s/location-outbound-scans',
      key: 'same',
      body: JSON.stringify(body),
    },
    {
      path: '/shipments/s/location-outbound-scans',
      key: 'same',
      body: JSON.stringify(body),
    },
  ]);
});
it('구형 미확인 출고는 새 위치 계약으로 변경하지 않고 원래 본문을 재생한다', async () => {
  const store = createOperationStore(crypto.randomUUID());
  const bodyJson = JSON.stringify({ barcode: '8801', quantity: 1 });
  await store.begin({
    id: 'old-key',
    scope: 'scope',
    resource: '/shipments/s',
    path: '/shipments/s/simple-outbound-scans',
    method: 'POST',
    bodyJson,
    createdAt: Date.now(),
  });
  const api: ApiClient = {
    request: vi.fn(async () => ({
      shipmentId: 's',
      status: 'shipped',
      lines: [],
    })) as ApiClient['request'],
  };
  const runner = createOperationRunner({
    api,
    store,
    getScope: async () => 'scope',
    wait: async () => {},
  });
  await runner.retryPending();
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/shipments/s/simple-outbound-scans',
      bodyJson,
      idempotencyKey: 'old-key',
    })
  );
  expect((await store.get('old-key'))?.status).toBe('confirmed');
});
for (const path of [
  '/shipments/s/location-outbound-starts',
  '/shipments/s/location-outbound-forces',
  '/stocktaking/count-items',
]) {
  it(`${path} 저장 실패 시 HTTP 요청을 보내지 않는다`, async () => {
    const store = createOperationStore(crypto.randomUUID());
    vi.spyOn(store, 'begin').mockRejectedValue(new Error('disk full'));
    const api: ApiClient = { request: vi.fn() };
    const runner = createOperationRunner({
      api,
      store,
      getScope: async () => 'scope',
    });
    await expect(
      runner.request({ method: 'POST', path, body: {}, idempotencyKey: 'k' })
    ).rejects.toThrow('disk full');
    expect(api.request).not.toHaveBeenCalled();
  });
}

describe('location force resolution', () => {
  const path = '/shipments/s/location-outbound-forces';
  const resolutionPath = '/shipments/s/location-outbound-force-resolutions';
  const body = {
    warehouseId: 'w',
    reason: 'checked',
    items: [{ shipmentLineId: 'l', sourceLocationId: 'B', quantity: 2 }],
  };
  const confirmed = {
    shipmentId: 's',
    warehouseId: 'w',
    status: 'shipped',
    workItemStatus: 'completed',
    dispatchAttemptId: 'd',
    lines: [
      {
        shipmentLineId: 'l',
        skuId: 'sku',
        qty: 2,
        pickedQty: 2,
        inspectedQty: 2,
      },
    ],
    sources: [],
  };
  const rejected = {
    outcome: 'rejected',
    code: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED',
  };
  async function savedForce(name = crypto.randomUUID(), savedPath = path) {
    const store = createOperationStore(name);
    await store.begin({
      id: 'force-key',
      scope: 'a',
      resource: '/shipments/s',
      method: 'POST',
      path: savedPath,
      bodyJson: JSON.stringify(body),
      createdAt: Date.now(),
    });
    await store.finish('force-key', 'uncertain');
    return store;
  }
  it('resolves an initial 403 with the original key/body and durably rejects its waiting promise', async () => {
    const store = createOperationStore(crypto.randomUUID());
    const sent: Parameters<ApiClient['request']>[0][] = [];
    const runner = createOperationRunner({
      store,
      getScope: async () => 'a',
      wait: async () => {},
      api: {
        request: async <T>(o: Parameters<ApiClient['request']>[0]) => {
          sent.push(o);
          if (o.path === path) throw new ApiError('forbidden', 403);
          return rejected as T;
        },
      },
    });
    const request = runner
      .request({ method: 'POST', path, body, idempotencyKey: 'force-key' })
      .catch((e) => e);
    await vi.waitFor(async () =>
      expect((await store.get('force-key'))?.status).toBe('rejected')
    );
    expect(await request).toMatchObject({
      code: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED',
    });
    expect(sent.map((o) => o.path)).toEqual([path, resolutionPath]);
    expect(
      sent.every(
        (o) =>
          o.idempotencyKey === 'force-key' &&
          o.bodyJson === JSON.stringify(body)
      )
    ).toBe(true);
    expect(await store.pending('a')).toEqual([]);
  });
  it('restores a version 1 uncertain record and confirms without reexecuting force after permission revocation', async () => {
    const name = crypto.randomUUID();
    await savedForce(name);
    const store = createOperationStore(name);
    const sent: string[] = [];
    const runner = createOperationRunner({
      store,
      getScope: async () => 'a',
      api: {
        request: async <T>(o: Parameters<ApiClient['request']>[0]) => {
          sent.push(o.path);
          return { outcome: 'confirmed', result: confirmed } as T;
        },
      },
    });
    await runner.restore();
    await runner.retryPending();
    expect(sent).toEqual([resolutionPath]);
    expect(await store.get('force-key')).toMatchObject({
      status: 'confirmed',
      result: confirmed,
      path,
      bodyJson: JSON.stringify(body),
    });
  });
  it('rechecks the same resolution after response loss without ever reexecuting the original force', async () => {
    const store = await savedForce();
    let lost = true;
    const sent: Parameters<ApiClient['request']>[0][] = [];
    const runner = createOperationRunner({
      store,
      getScope: async () => 'a',
      wait: async () => {},
      api: {
        request: async <T>(o: Parameters<ApiClient['request']>[0]) => {
          sent.push(o);
          if (lost) throw new ApiError('lost', 403);
          return rejected as T;
        },
      },
    });
    await runner.retryPending();
    expect((await store.get('force-key'))?.status).toBe('uncertain');
    lost = false;
    await runner.retryPending();
    expect((await store.get('force-key'))?.status).toBe('rejected');
    expect(sent.map((o) => o.path)).toEqual([resolutionPath, resolutionPath]);
    expect(
      sent.every(
        (o) =>
          o.idempotencyKey === 'force-key' &&
          o.bodyJson === JSON.stringify(body)
      )
    ).toBe(true);
  });
  it.each([
    undefined,
    {},
    { outcome: 'rejected', code: 'Forbidden' },
    { outcome: 'confirmed', result: {} },
    { outcome: 'confirmed', result: { ...confirmed, shipmentId: 'other' } },
    { outcome: 'confirmed', result: { ...confirmed, warehouseId: 'other' } },
  ])('keeps malformed resolution %j uncertain', async (value) => {
    const store = await savedForce();
    const runner = createOperationRunner({
      store,
      getScope: async () => 'a',
      wait: async () => {},
      api: { request: async <T>() => value as T },
    });
    await runner.retryPending();
    expect((await store.get('force-key'))?.status).toBe('uncertain');
  });
  it.each([401, 403, 404, 409, 500])(
    'keeps resolver HTTP %i uncertain even for generic rejected error codes',
    async (status) => {
      const store = await savedForce();
      const runner = createOperationRunner({
        store,
        getScope: async () => 'a',
        wait: async () => {},
        api: {
          request: async () => {
            throw new ApiError('failed', status, 'BAD_REQUEST');
          },
        },
      });
      await runner.retryPending();
      expect((await store.get('force-key'))?.status).toBe('uncertain');
    }
  );
  it('does not persist or settle a resolution after switching accounts', async () => {
    const store = await savedForce();
    let actor = 'a';
    const runner = createOperationRunner({
      store,
      getScope: async () => actor,
      api: {
        request: async <T>() => {
          actor = 'b';
          return rejected as T;
        },
      },
    });
    await runner.retryPending();
    expect((await store.get('force-key'))?.status).toBe('uncertain');
  });
  it('does not send another account’s saved force', async () => {
    const store = await savedForce();
    let sends = 0;
    const runner = createOperationRunner({
      store,
      getScope: async () => 'b',
      api: {
        request: async <T>() => {
          sends++;
          return rejected as T;
        },
      },
    });
    await runner.retryPending();
    expect(sends).toBe(0);
    expect((await store.get('force-key'))?.status).toBe('uncertain');
  });
  it('requires the original principal at resolver transport', async () => {
    const store = await savedForce();
    let sends = 0;
    const runner = createOperationRunner({
      store,
      getScope: async () => 'a',
      assertPrincipal: async () => {
        throw new Error('changed principal');
      },
      api: {
        request: async <T>(o: Parameters<ApiClient['request']>[0]) => {
          await o.beforeSend?.('b');
          sends++;
          return rejected as T;
        },
      },
    });
    await runner.retryPending();
    expect(sends).toBe(0);
    expect((await store.get('force-key'))?.status).toBe('uncertain');
  });
  it('preserves unresolved work if terminal persistence fails', async () => {
    const store = await savedForce();
    const finish = store.finish;
    vi.spyOn(store, 'finish').mockImplementation(async (...args) => {
      if (args[1] === 'rejected') throw new Error('disk full');
      return finish(...args);
    });
    const runner = createOperationRunner({
      store,
      getScope: async () => 'a',
      wait: async () => {},
      api: { request: async <T>() => rejected as T },
    });
    await expect(runner.retryPending()).rejects.toThrow('disk full');
    expect(await store.pending('a')).toHaveLength(1);
  });
  it('does not overwrite a lease claimed by another window while resolving', async () => {
    const store = await savedForce();
    const runner = createOperationRunner({
      store,
      getScope: async () => 'a',
      api: {
        request: async <T>() => {
          await store.claim(
            'force-key',
            'a',
            'other-window',
            Date.now() + 21000
          );
          return rejected as T;
        },
      },
    });
    await expect(runner.retryPending()).rejects.toThrow();
    expect((await store.get('force-key'))?.status).not.toBe('rejected');
  });
  it('uses the status after claiming the lease when another window sent force between the read and claim', async () => {
    const store = createOperationStore(crypto.randomUUID());
    await store.begin({
      id: 'force-key',
      scope: 'a',
      resource: '/shipments/s',
      method: 'POST',
      path,
      bodyJson: JSON.stringify(body),
      createdAt: Date.now(),
    });
    const claim = store.claim;
    let raced = false;
    vi.spyOn(store, 'claim').mockImplementation(async (...args) => {
      if (!raced) {
        raced = true;
        await store.finish('force-key', 'sending');
        await store.finish('force-key', 'uncertain');
      }
      return claim(...args);
    });
    const sent: string[] = [];
    const runner = createOperationRunner({
      store,
      getScope: async () => 'a',
      wait: async () => {},
      api: {
        request: async <T>(o: Parameters<ApiClient['request']>[0]) => {
          sent.push(o.path);
          return rejected as T;
        },
      },
    });
    await runner.retryPending();
    expect(sent).toEqual([resolutionPath]);
    expect((await store.get('force-key'))?.status).toBe('rejected');
  });
  it('retains legacy simple force path and body on uncertain replay', async () => {
    const oldPath = '/shipments/s/simple-outbound-forces';
    const store = await savedForce(crypto.randomUUID(), oldPath);
    const sent: string[] = [];
    const runner = createOperationRunner({
      store,
      getScope: async () => 'a',
      api: {
        request: async <T>(o: Parameters<ApiClient['request']>[0]) => {
          sent.push(o.path);
          return confirmed as T;
        },
      },
    });
    await runner.retryPending();
    expect(sent).toEqual([oldPath]);
    expect((await store.get('force-key'))?.status).toBe('confirmed');
  });
});

describe('inbound workflow rejection outcomes', () => {
  const codes = [
    'INBOUND_ORIGIN_STOCK_PROTECTED',
    'INBOUND_ORIGIN_STOCK_INCONSISTENT',
    'INBOUND_PUTAWAY_DESTINATION_INVALID',
  ];
  it.each(codes)(
    'settles %s from the original saved request as rejected',
    async (code) => {
      const store = createOperationStore(crypto.randomUUID());
      const runner = createOperationRunner({
        store,
        getScope: async () => 'a',
        api: {
          request: async () => {
            throw new ApiError('rejected', 409, code);
          },
        },
      });
      expect(new ApiError('rejected', 409, code).outcome).toBe('rejected');
      await expect(
        runner.request({
          path: '/movement/move',
          method: 'POST',
          body: { warehouseId: 'w' },
          idempotencyKey: 'original',
        })
      ).rejects.toMatchObject({ code, outcome: 'rejected' });
      expect((await store.get('original'))?.status).toBe('rejected');
    }
  );
  it.each([401, 403, 408, 429, 500])(
    'keeps protected code with status %s uncertain',
    (status) => {
      expect(new ApiError('unknown', status, codes[0]).outcome).toBe(
        'uncertain'
      );
    }
  );
  it('does not treat an unknown 409 as a rejection', () => {
    expect(new ApiError('unknown', 409, 'UNRECOGNIZED_CODE').outcome).toBe(
      'uncertain'
    );
  });
});

it.each([
  [
    'INBOUND_ORIGIN_STOCK_PROTECTED',
    '이 상품은 적치 대기 중이에요. 적치에서 처리해 주세요.',
  ],
  [
    'INBOUND_ORIGIN_STOCK_INCONSISTENT',
    '입고 기록과 현재 재고가 맞지 않아요. 입고내역과 실물을 확인해 주세요.',
  ],
  [
    'INBOUND_PUTAWAY_DESTINATION_INVALID',
    '같은 창고의 일반 로케이션을 선택해 주세요.',
  ],
])(
  'guides %s even when replay settles it as ApiError status 400',
  (code, message) => {
    expect(
      errorMessage(
        new ApiError('작업이 반영되지 않았어요.', 400, code),
        'movement'
      )
    ).toBe(message);
  }
);

it('persists preparation metadata for live rejection and restarted same-key replay', async () => {
  const name = crypto.randomUUID();
  const store = createOperationStore(name);
  let sends = 0;
  const preparation = {
    reasonCode: 'SOURCE_INSUFFICIENT',
    recovery: 'retry_preparation',
  } as const;
  const api: ApiClient = {
    request: async () => {
      sends++;
      throw new ApiError(
        'blocked',
        409,
        'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
        preparation
      );
    },
  };
  const options = {
    api,
    store,
    getScope: async () => 'actor|server',
    wait: async () => {},
  };
  const request = {
    method: 'POST',
    path: '/shipments/s/location-outbound-starts',
    body: { warehouseId: 'w' },
    idempotencyKey: 'blocked-start',
  };
  await expect(
    createOperationRunner(options).request(request)
  ).rejects.toMatchObject({ outcome: 'rejected', preparation });
  const reopened = createOperationStore(name);
  expect(await reopened.get('blocked-start')).toMatchObject({
    status: 'rejected',
    preparation,
    bodyJson: '{"warehouseId":"w"}',
  });
  await expect(
    createOperationRunner({ ...options, store: reopened }).request(request)
  ).rejects.toMatchObject({ preparation });
  expect(sends).toBe(1);
  for (const scope of ['other-actor|server', 'actor|other-server'])
    await expect(
      createOperationRunner({
        ...options,
        store: reopened,
        getScope: async () => scope,
      }).request(request)
    ).rejects.toThrow('처리 여부를 먼저 확인');
  expect(sends).toBe(1);
});
