import 'fake-indexeddb/auto';
import {
  OperationContext,
  type WorkRuntime,
} from '../../core/operations/OperationContext';
import { createOperationStore } from '../../core/operations/operationStore';
import { createOperationRunner } from '../../core/operations/operationRunner';
import { expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import {
  ScanProvider,
  useScanBus,
} from '../../core/hardware/scan/ScanProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import type { ApiClient } from '../../core/data/httpClient';
import { WorkBoundary } from '../../core/operations/WorkBoundary';
import { ApiError } from '../../core/data/httpClient';
import { LocationOutboundScreen } from './LocationOutboundScreen';
let emitScan: (code: string) => void;
function ScanProbe() {
  const bus = useScanBus();
  emitScan = (code) => bus.emit({ code, source: 'hid', at: Date.now() });
  return null;
}
const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
};
const shipment = {
  shipmentId: 's',
  warehouseId: 'w',
  outboundContract: 'location' as const,
  trackingNo: 'T',
  carrier: '택배',
  waybillStatus: 'registered',
  shipmentStatus: 'planned',
  batchId: 'b',
  workItemId: 'wi',
  workItemStatus: 'queued',
  recipientMasked: '김**',
  lines: [
    {
      shipmentLineId: 'line',
      skuId: 'sku',
      skuCode: 'S',
      skuName: '셔츠',
      qty: 3,
      pickedQty: 0,
      inspectedQty: 0,
    },
  ],
};
const source = (id: string, qty: number) => ({
  shipmentLineId: 'line',
  skuId: 'sku',
  sourceLocationId: id,
  sourceLocationCode: id,
  allocatedQty: qty,
  pickedQty: 0,
  remainingQty: qty,
});
const state = {
  shipmentId: 's',
  warehouseId: 'w',
  status: 'in_progress',
  workItemStatus: 'picking',
  dispatchAttemptId: null,
  lines: [
    {
      shipmentLineId: 'line',
      skuId: 'sku',
      qty: 3,
      pickedQty: 0,
      inspectedQty: 0,
    },
  ],
  sources: [source('A', 1), source('B', 2)],
};
function mount(
  request: ApiClient['request'],
  warehouseId = 'w',
  runtime: WorkRuntime | null = null
) {
  const prefs = createMemoryPrefs({
    'almondwms.warehouse': JSON.stringify({
      id: warehouseId,
      name: '시험창고',
    }),
  });
  const root = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <LocationOutboundScreen
        shipmentId="s"
        shipment={shipment}
        prefs={prefs}
      />
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <SessionProvider session={session}>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={{ request }}>
          <WarehouseProvider prefs={prefs}>
            <OperationContext.Provider value={runtime}>
              <ScanProvider>
                <ScanProbe />
                <WorkBoundary>
                  <RouterProvider router={router} />
                </WorkBoundary>
              </ScanProvider>
            </OperationContext.Provider>
          </WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return { ...view, queryClient };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function fixture(
  total = 3,
  options: {
    getPermissions?: () => Promise<{ forceDispatch?: boolean }>;
    forceRequest?: ApiClient['request'];
  } = {}
) {
  const store = createOperationStore(crypto.randomUUID());
  await store.draft('scope:draft:location-outbound:s', () => ({
    startKey: 'start',
    started: true,
    sourceId: 'B',
  }));
  let picked = 0;
  let readGate: ReturnType<typeof deferred> | undefined;
  let sendGate: ReturnType<typeof deferred> | undefined;
  let loseResponse = false;
  const calls: Array<{ id: string; body: Record<string, unknown> }> = [];
  const requests: Parameters<ApiClient['request']>[0][] = [];
  const applied = new Map<string, typeof state>();
  const snapshot = () => ({
    ...state,
    status: picked === total ? 'shipped' : 'in_progress',
    lines: [{ ...state.lines[0], qty: total, pickedQty: picked }],
    sources:
      picked === total
        ? []
        : [
            {
              ...source('B', total),
              pickedQty: picked,
              remainingQty: total - picked,
            },
          ],
  });
  const api: ApiClient = {
    request: async <T,>(o: Parameters<ApiClient['request']>[0]) => {
      requests.push(o);
      if (
        o.path.endsWith('location-outbound-forces') ||
        o.path.endsWith('location-outbound-force-resolutions')
      ) {
        if (!options.forceRequest) throw new Error('Unexpected force');
        return options.forceRequest<T>(o);
      }
      if (o.path.includes('location-outbound-state')) {
        const result = snapshot();
        await readGate?.promise;
        return result as T;
      }
      if (o.path.endsWith('location-outbound-scans')) {
        const id = o.idempotencyKey!;
        const body = o.body as Record<string, unknown>;
        calls.push({ id, body });
        await sendGate?.promise;
        if (!applied.has(id)) {
          if (body.barcode === 'invalid')
            throw new ApiError(
              '상품을 확인해 주세요.',
              400,
              'SIMPLE_OUTBOUND_BARCODE_UNKNOWN'
            );
          picked += Number(body.quantity);
          applied.set(id, snapshot());
        }
        if (loseResponse) throw new ApiError('응답 유실', 403);
        return applied.get(id) as T;
      }
      throw new Error('Unexpected request ' + o.path);
    },
  };
  const runner = createOperationRunner({
    api,
    store,
    getScope: async () => 'scope',
    wait: async () => {},
  });
  const runtime = {
    store,
    runner,
    getScope: async () => 'scope',
    getCapabilities: async () => ({ locationOutbound: true }),
    getPermissions:
      options.getPermissions ?? (async () => ({ forceDispatch: true })),
  };
  const view = mount(runner.request, 'w', runtime);
  const select = await screen.findByRole('button', { name: 'B 선택' });
  await waitFor(() => expect(select).toBeEnabled());
  await userEvent.click(select);
  await waitFor(() =>
    expect(screen.getByLabelText('출고 상품 바코드')).toBeEnabled()
  );
  return {
    api,
    store,
    runner,
    runtime,
    view,
    calls,
    requests,
    applied,
    picked: () => picked,
    complete: () => {
      picked = total;
    },
    holdReads() {
      return (readGate = deferred());
    },
    holdSends() {
      return (sendGate = deferred());
    },
    loseResponse(value: boolean) {
      loseResponse = value;
    },
    saved: () =>
      store.draft<Array<{ id: string; data: Record<string, unknown> }>>(
        'scope:scan:location-outbound-scans:s'
      ),
  };
}
it.each([2, 100])(
  'persists all %i repeated scans while sending and refreshing, preserving keyboard focus and inert boundaries',
  async (count) => {
    const f = await fixture(count + 1);
    const send = f.holdSends();
    const read = f.holdReads();
    const input = screen.getByLabelText('출고 상품 바코드');
    await userEvent.type(input, '8801{Enter}');
    await waitFor(() => expect(f.calls).toHaveLength(1));
    expect(input).toHaveFocus();
    expect(input).toBeEnabled();
    expect(input.closest('[inert]')).toBeNull();
    expect(screen.getByRole('button', { name: '위치 변경' })).toBeDisabled();
    if (count === 2) await userEvent.type(input, '8801{Enter}');
    else {
      input.blur();
      act(() => {
        for (let i = 1; i < count; i++) {
          for (const key of '8801') fireEvent.keyDown(document.body, { key });
          fireEvent.keyDown(document.body, { key: 'Enter' });
        }
      });
    }
    await waitFor(async () => expect(await f.saved()).toHaveLength(count));
    expect(new Set((await f.saved())!.map((e) => e.id)).size).toBe(count);
    send.resolve();
    await waitFor(() => expect(f.picked()).toBe(1));
    expect(input).toBeEnabled();
    expect(input.closest('[inert]')).toBeNull();
    read.resolve();
    await waitFor(() => expect(f.applied.size).toBe(count), { timeout: 10000 });
    await waitFor(async () => expect(await f.saved()).toHaveLength(0));
    expect(f.picked()).toBe(count);
    expect(
      f.calls.every(
        (c) => c.body.sourceLocationId === 'B' && c.body.quantity === 1
      )
    ).toBe(true);
  }
);
it('reports excess queued input after shipment completion instead of silently consuming it', async () => {
  const f = await fixture(1);
  const send = f.holdSends();
  act(() => {
    emitScan('8801');
    emitScan('8801');
  });
  await waitFor(async () => expect(await f.saved()).toHaveLength(2));
  send.resolve();
  await screen.findByText('출고완료');
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('반영되지 않았어요')
  );
  expect(f.picked()).toBe(1);
});

it('keeps A, A, B scan order and fixed quantities while reads are delayed', async () => {
  const f = await fixture(5);
  const read = f.holdReads();
  act(() => emitScan('A'));
  await waitFor(() => expect(f.applied.size).toBe(1));
  act(() => {
    emitScan('A');
    emitScan('B');
  });
  await waitFor(async () => expect(await f.saved()).toHaveLength(3));
  read.resolve();
  await waitFor(async () => expect(await f.saved()).toHaveLength(0));
  expect(f.calls.map((c) => c.body.barcode)).toEqual(['A', 'A', 'B']);
  expect(f.picked()).toBe(3);
});
it('blocks intake after response loss and reconciles the original key without duplicate picking', async () => {
  const f = await fixture(4);
  f.loseResponse(true);
  act(() => {
    emitScan('A');
    emitScan('B');
  });
  await waitFor(async () =>
    expect((await f.store.pending('scope'))[0]?.status).toBe('uncertain')
  );
  const input = screen.getByLabelText('출고 상품 바코드');
  await waitFor(() => expect(input).toBeDisabled());
  expect(input.closest('[inert]')).not.toBeNull();
  act(() => emitScan('extra'));
  expect((await f.saved())!.map((e) => e.data.barcode)).toEqual(['A', 'B']);
  const firstKey = f.calls[0].id;
  f.loseResponse(false);
  const send = f.holdSends();
  let retry!: Promise<void>;
  act(() => {
    retry = f.runner.retryPending();
  });
  await waitFor(() => expect(f.calls).toHaveLength(2));
  expect(input).toBeDisabled();
  send.resolve();
  await act(async () => retry);
  await waitFor(async () => expect(await f.saved()).toHaveLength(0));
  expect(f.calls.slice(0, 2).map((c) => c.id)).toEqual([firstKey, firstKey]);
  expect(f.picked()).toBe(2);
  expect(f.applied.size).toBe(2);
});
it('reopening replays persisted inputs with their original keys and latest progress', async () => {
  const f = await fixture(4);
  f.loseResponse(true);
  act(() => {
    emitScan('A');
    emitScan('B');
  });
  await waitFor(async () =>
    expect((await f.store.pending('scope'))[0]?.status).toBe('uncertain')
  );
  const saved = (await f.saved())!;
  f.view.unmount();
  f.loseResponse(false);
  const reopenedRunner = createOperationRunner({
    api: f.api,
    store: f.store,
    getScope: f.runtime.getScope,
    wait: async () => {},
  });
  mount(reopenedRunner.request, 'w', { ...f.runtime, runner: reopenedRunner });
  await act(async () => reopenedRunner.retryPending());
  await waitFor(async () => expect(await f.saved()).toHaveLength(0));
  expect([...f.applied.keys()]).toEqual(saved.map((e) => e.id));
  expect(f.picked()).toBe(2);
  expect(await screen.findByText(/피킹 2 \/ 남은 2개/)).toBeInTheDocument();
});
it.each(['other shipment', 'other source', 'scope failure'])(
  'blocks the scan exception for %s',
  async (kind) => {
    const f = await fixture(3);
    if (kind === 'scope failure')
      vi.spyOn(f.runtime, 'getScope').mockRejectedValue(
        new Error('account changed')
      );
    else {
      const otherShipment = kind === 'other shipment';
      await f.store.begin({
        id: 'foreign',
        scope: 'scope',
        resource: otherShipment ? '/shipments/other' : '/shipments/s',
        path: `/shipments/${otherShipment ? 'other' : 's'}/location-outbound-scans`,
        method: 'POST',
        createdAt: Date.now(),
        bodyJson: JSON.stringify({
          warehouseId: 'w',
          sourceLocationId: otherShipment ? 'B' : 'A',
          barcode: 'A',
          quantity: 1,
        }),
      });
      await f.store.finish('foreign', 'sending');
    }
    if (kind === 'scope failure')
      act(() => window.dispatchEvent(new Event('online')));
    else await act(async () => f.runner.restore());
    const input = screen.getByLabelText('출고 상품 바코드');
    await waitFor(() => expect(input).toBeDisabled());
    expect(input.closest('[inert]')).not.toBeNull();
    act(() => emitScan('A'));
    expect(f.calls).toHaveLength(0);
    expect((await f.saved()) ?? []).toHaveLength(0);
  }
);
it('preserves an unsaved scan on storage failure and rejects further intake until recovery', async () => {
  const f = await fixture(3);
  const original = f.store.draft;
  let diskFull = true;
  vi.spyOn(f.store, 'draft').mockImplementation(async (id, update) => {
    if (id.includes(':scan:') && update && diskFull)
      throw new Error('disk full');
    return original(id, update);
  });
  act(() => emitScan('A'));
  await screen.findByText(/스캔을 저장하지 못했어요/);
  expect(screen.getByLabelText('출고 상품 바코드')).toBeDisabled();
  act(() => emitScan('B'));
  expect(f.calls).toHaveLength(0);
  diskFull = false;
  await userEvent.click(
    await screen.findByRole('button', { name: '처리 내역 확인' })
  );
  await waitFor(() => expect(f.picked()).toBe(1));
  await waitFor(async () => expect(await f.saved()).toHaveLength(0));
  expect(f.calls.map((c) => c.body.barcode)).toEqual(['A']);
});
it('shows confirmed invalid input without applying stock and accepts a corrected scan', async () => {
  const f = await fixture(3);
  act(() => emitScan('invalid'));
  await screen.findByRole('alert');
  await waitFor(async () => expect(await f.saved()).toHaveLength(0));
  expect(f.picked()).toBe(0);
  act(() => emitScan('A'));
  await waitFor(() => expect(f.picked()).toBe(1));
  await waitFor(async () => expect(await f.saved()).toHaveLength(0));
  expect(f.calls).toHaveLength(2);
});

it('explains the initial recovery lock and ignores HID input until the saved work is read', async () => {
  const f = await fixture(3);
  f.view.unmount();
  const read = f.holdReads();
  mount(f.runner.request, 'w', f.runtime);
  await screen.findByText('작업을 확인하고 있어요. 잠시만 기다려 주세요.');
  act(() => emitScan('A'));
  expect(f.calls).toHaveLength(0);
  expect((await f.saved()) ?? []).toHaveLength(0);
  read.resolve();
  const select = await screen.findByRole('button', { name: 'B 선택' });
  await waitFor(() => expect(select).toBeEnabled());
});

it('keeps intake locked until WorkBoundary has discovered pending operations', async () => {
  const f = await fixture(3);
  f.view.unmount();
  const restore = f.runner.restore;
  const gate = deferred();
  vi.spyOn(f.runner, 'restore').mockImplementation(async () => {
    await gate.promise;
    await restore();
  });
  mount(f.runner.request, 'w', f.runtime);
  const select = await screen.findByRole('button', { name: 'B 선택' });
  expect(select).toBeDisabled();
  act(() => emitScan('B'));
  expect(f.calls).toHaveLength(0);
  gate.resolve();
  await waitFor(() => expect(select).toBeEnabled());
});

async function submitForce() {
  await userEvent.click(
    await screen.findByRole('button', { name: '스캔 생략 확인' })
  );
  await userEvent.type(screen.getByLabelText(/B 실물 수량/), '3');
  await userEvent.type(
    screen.getByLabelText('스캔 생략 사유'),
    '포장 실물 확인'
  );
  await userEvent.click(
    screen.getByRole('button', { name: '확인한 수량 출고' })
  );
}
it.each(['worker', 'missing', 'failed'])(
  'keeps normal scanning available and force unavailable when permission is %s',
  async (permission) => {
    const f = await fixture(3, {
      getPermissions: async () => {
        if (permission === 'failed') throw new Error('offline');
        return permission === 'missing' ? {} : { forceDispatch: false };
      },
    });
    expect(
      screen.queryByRole('button', { name: '스캔 생략 확인' })
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText(/스캔 생략 출고는 관리자 권한이 필요해요/)
    ).toBeInTheDocument();
    act(() => emitScan('A'));
    await waitFor(() => expect(f.picked()).toBe(1));
    expect(
      f.requests.filter((r) => r.path.endsWith('location-outbound-forces'))
    ).toHaveLength(0);
  }
);
it.each(['revoked', 'lookup failed'])(
  'checks force permission immediately before saving when permission is %s',
  async (permission) => {
    let reads = 0;
    const f = await fixture(3, {
      getPermissions: async () => {
        if (++reads === 1) return { forceDispatch: true };
        if (permission === 'lookup failed') throw new Error('offline');
        return { forceDispatch: false };
      },
    });
    await submitForce();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('alert')).toHaveTextContent('권한');
    expect(
      f.requests.filter((r) => r.path.endsWith('location-outbound-forces'))
    ).toHaveLength(0);
    expect(await f.store.pending('scope')).toHaveLength(0);
    act(() => emitScan('A'));
    await waitFor(() => expect(f.picked()).toBe(1));
  }
);
it('closes physical confirmation after persisted non-application and accepts ordinary scans', async () => {
  const gate = deferred();
  const f = await fixture(3, {
    forceRequest: async <T,>(o: Parameters<ApiClient['request']>[0]) => {
      if (o.path.endsWith('location-outbound-forces'))
        throw new ApiError('forbidden', 403);
      await gate.promise;
      return {
        outcome: 'rejected',
        code: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED',
      } as T;
    },
  });
  await submitForce();
  await waitFor(() =>
    expect(
      f.requests.filter((r) =>
        r.path.endsWith('location-outbound-force-resolutions')
      )
    ).toHaveLength(1)
  );
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByLabelText('출고 상품 바코드')).toBeDisabled();
  gate.resolve();
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  );
  expect(
    await screen.findByText(/스캔 생략 출고가 반영되지 않았어요/)
  ).toBeInTheDocument();
  const force = f.requests.find((r) =>
    r.path.endsWith('location-outbound-forces')
  )!;
  expect((await f.store.get(force.idempotencyKey!))?.status).toBe('rejected');
  act(() => emitScan('A'));
  await waitFor(() => expect(f.picked()).toBe(1));
});
it('keeps the dialog and boundary blocked after resolver loss, then recovers using the same command', async () => {
  let lost = true;
  const f = await fixture(3, {
    forceRequest: async <T,>(o: Parameters<ApiClient['request']>[0]) => {
      if (o.path.endsWith('location-outbound-forces') || lost)
        throw new ApiError('lost', 403);
      return {
        outcome: 'rejected',
        code: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED',
      } as T;
    },
  });
  await submitForce();
  await waitFor(async () =>
    expect((await f.store.pending('scope'))[0]?.status).toBe('uncertain')
  );
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  const input = screen.getByLabelText('출고 상품 바코드');
  expect(input).toBeDisabled();
  expect(input.closest('[inert]')).not.toBeNull();
  await waitFor(async () => {
    const saved = (await f.store.pending('scope'))[0];
    expect(saved?.status).toBe('uncertain');
    expect(saved?.leaseExpiresAt).toBe(0);
  });
  lost = false;
  await userEvent.click(
    await screen.findByRole('button', { name: '처리 내역 확인' })
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  );
  const writes = f.requests.filter((r) => r.method === 'POST');
  expect(writes.map((r) => r.path)).toEqual([
    '/shipments/s/location-outbound-forces',
    '/shipments/s/location-outbound-force-resolutions',
    '/shipments/s/location-outbound-force-resolutions',
  ]);
  expect(new Set(writes.map((r) => r.idempotencyKey)).size).toBe(1);
  expect(new Set(writes.map((r) => r.bodyJson)).size).toBe(1);
});

it('preserves the active force promise and dialog when terminal storage fails, then settles after durable recovery', async () => {
  const f = await fixture(3, {
    forceRequest: async <T,>(o: Parameters<ApiClient['request']>[0]) => {
      if (o.path.endsWith('location-outbound-forces'))
        throw new ApiError('forbidden', 403);
      return {
        outcome: 'rejected',
        code: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED',
      } as T;
    },
  });
  const finish = f.store.finish;
  let failed = false;
  let diskFull = true;
  vi.spyOn(f.store, 'finish').mockImplementation(async (...args) => {
    if (diskFull && args[1] === 'rejected') {
      failed = true;
      throw new Error('disk full');
    }
    return finish(...args);
  });
  await submitForce();
  await waitFor(() => expect(failed).toBe(true));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByLabelText('출고 상품 바코드')).toBeDisabled();
  expect(await f.store.pending('scope')).toHaveLength(1);
  act(() => emitScan('A'));
  expect(f.picked()).toBe(0);
  diskFull = false;
  await act(async () => f.runner.retryPending());
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  );
  expect(await f.store.pending('scope')).toHaveLength(0);
});
it('restores old uncertain force using its saved body and shows confirmed completion after force permission is revoked', async () => {
  const f = await fixture(3, {
    getPermissions: async () => ({ forceDispatch: false }),
    forceRequest: async <T,>(o: Parameters<ApiClient['request']>[0]) => {
      if (!o.path.endsWith('location-outbound-force-resolutions'))
        throw new Error('Force must not execute');
      f.complete();
      return {
        outcome: 'confirmed',
        result: {
          ...state,
          status: 'shipped',
          dispatchAttemptId: 'dispatch',
          workItemStatus: 'completed',
          lines: [{ ...state.lines[0], pickedQty: 3, inspectedQty: 3 }],
          sources: [],
        },
      } as T;
    },
  });
  f.view.unmount();
  const bodyJson = JSON.stringify({
    warehouseId: 'w',
    reason: '확인',
    items: [{ shipmentLineId: 'line', sourceLocationId: 'B', quantity: 3 }],
  });
  await f.store.begin({
    id: 'old-force',
    scope: 'scope',
    resource: '/shipments/s',
    method: 'POST',
    path: '/shipments/s/location-outbound-forces',
    bodyJson,
    createdAt: Date.now(),
  });
  await f.store.finish('old-force', 'uncertain');
  const runner = createOperationRunner({
    api: f.api,
    store: f.store,
    getScope: f.runtime.getScope,
    wait: async () => {},
  });
  mount(runner.request, 'w', { ...f.runtime, runner });
  await userEvent.click(
    await screen.findByRole('button', { name: '처리 내역 확인' })
  );
  expect(await screen.findByText('출고완료')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '다음 송장 스캔' })).toBeEnabled()
  );
  expect(await f.store.get('old-force')).toMatchObject({
    status: 'confirmed',
    bodyJson,
  });
  expect(
    f.requests
      .filter((o) => o.method === 'POST')
      .map((o) => ({ path: o.path, key: o.idempotencyKey, body: o.bodyJson }))
  ).toEqual([
    {
      path: '/shipments/s/location-outbound-force-resolutions',
      key: 'old-force',
      body: bodyJson,
    },
  ]);
});

it('hides previously granted force permission when its refresh fails', async () => {
  let failed = false;
  const f = await fixture(3, {
    getPermissions: async () => {
      if (failed) throw new Error('offline');
      return { forceDispatch: true };
    },
  });
  expect(
    await screen.findByRole('button', { name: '스캔 생략 확인' })
  ).toBeEnabled();
  failed = true;
  await act(async () =>
    f.view.queryClient.invalidateQueries({ queryKey: ['work-permissions'] })
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: '스캔 생략 확인' })
    ).not.toBeInTheDocument()
  );
  act(() => emitScan('A'));
  await waitFor(() => expect(f.picked()).toBe(1));
});

// HTTP boundary is the only fake: the screen, hooks, runner and IndexedDB store are real.
async function preparationFixture(
  recovery: 'retry_preparation' | 'review_batch' = 'retry_preparation'
) {
  const storeName = crypto.randomUUID();
  const store = createOperationStore(storeName);
  const draftId = 'scope:draft:location-outbound:s';
  let blocked = true;
  let lost = false;
  let readFailed = false;
  let missing = false;
  let current = { ...state, sources: [source('B', 3)] };
  const saved = new Map<string, typeof current | ApiError>();
  const requests: Parameters<ApiClient['request']>[0][] = [];
  const api: ApiClient = {
    request: async <T,>(o: Parameters<ApiClient['request']>[0]) => {
      requests.push(o);
      if (o.path.includes('location-outbound-state')) {
        if (readFailed) throw new Error('GET state → 503');
        return (missing ? null : current) as T;
      }
      if (o.path.endsWith('location-outbound-starts')) {
        const key = o.idempotencyKey!;
        const draft = await store.draft<{ startKey: string }>(draftId);
        expect(draft?.startKey).toBe(key);
        if (!saved.has(key))
          saved.set(
            key,
            blocked
              ? new ApiError(
                  'blocked',
                  409,
                  'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
                  {
                    reasonCode:
                      recovery === 'review_batch'
                        ? 'SHIPMENT_SNAPSHOT_CHANGED'
                        : 'SOURCE_INSUFFICIENT',
                    recovery,
                  }
                )
              : current
          );
        if (lost) throw new ApiError('response lost', 403);
        const result = saved.get(key)!;
        if (result instanceof ApiError) throw result;
        return result as T;
      }
      throw new Error('Unexpected request ' + o.path);
    },
  };
  const makeRuntime = (operationStore = store): WorkRuntime => ({
    store: operationStore,
    runner: createOperationRunner({
      api,
      store: operationStore,
      getScope: async () => 'scope',
      wait: async () => {},
    }),
    getScope: async () => 'scope',
    getCapabilities: async () => ({ locationOutbound: true }),
    getPermissions: async () => ({ forceDispatch: true }),
  });
  const runtime = makeRuntime();
  const view = mount(runtime.runner.request, 'w', runtime);
  const button = await screen.findByRole('button', { name: '출고 준비' });
  await waitFor(() => expect(button).toBeEnabled());
  return {
    store,
    runtime,
    view,
    makeRuntime,
    storeName,
    requests,
    draftId,
    writes: () => requests.filter((r) => r.method === 'POST'),
    available: () => {
      blocked = false;
    },
    lose: (value: boolean) => {
      lost = value;
    },
    failReads: (value: boolean) => {
      readFailed = value;
    },
    missingState: () => {
      missing = true;
    },
    changeSource: () => {
      current = { ...current, sources: [source('C', 3)] };
    },
  };
}
it.each([false, true])(
  'requires explicit new preparation after durable rejection (restart=%s)',
  async (restart) => {
    const f = await preparationFixture();
    await userEvent.click(screen.getByRole('button', { name: '출고 준비' }));
    await screen.findByText(/출고할 재고가 부족해요/);
    const first = f.writes()[0];
    expect(await f.store.get(first.idempotencyKey!)).toMatchObject({
      status: 'rejected',
      preparation: {
        reasonCode: 'SOURCE_INSUFFICIENT',
        recovery: 'retry_preparation',
      },
    });
    expect(await f.store.draft(f.draftId)).toMatchObject({
      startKey: first.idempotencyKey,
    });
    if (restart) {
      f.view.unmount();
      const runtime = f.makeRuntime(createOperationStore(f.storeName));
      mount(runtime.runner.request, 'w', runtime);
    }
    const retry = await screen.findByRole('button', { name: '다시 준비' });
    await waitFor(() => expect(retry).toBeEnabled());
    f.available();
    expect(f.writes()).toHaveLength(1);
    await userEvent.click(retry);
    await screen.findByRole('button', { name: 'B 선택' });
    expect(f.writes()).toHaveLength(2);
    expect(f.writes()[1].idempotencyKey).not.toBe(first.idempotencyKey);
    expect(f.writes()[1].bodyJson).toBe(first.bodyJson);
  }
);
it('does not send a new preparation when its draft cannot be saved', async () => {
  const f = await preparationFixture();
  await userEvent.click(screen.getByRole('button', { name: '출고 준비' }));
  const retry = await screen.findByRole('button', { name: '다시 준비' });
  const draft = f.store.draft;
  vi.spyOn(f.store, 'draft').mockImplementation(async (id, update) => {
    if (id === f.draftId && update) throw new Error('disk full');
    return draft(id, update);
  });
  await userEvent.click(retry);
  await screen.findByText(/작업을 저장하지 못했어요/);
  expect(f.writes()).toHaveLength(1);
});
it('offers batch review without a new preparation for review_batch', async () => {
  const f = await preparationFixture('review_batch');
  await userEvent.click(screen.getByRole('button', { name: '출고 준비' }));
  await screen.findByText(/배치와 송장을 확인해 주세요/);
  expect(
    screen.queryByRole('button', { name: '다시 준비' })
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: '출고 준비' })
    ).not.toBeInTheDocument()
  );
  expect(f.writes()).toHaveLength(1);
});
it.each([true, false])(
  'restores a lost preparation response using the original body and key (blocked=%s)',
  async (blocked) => {
    const f = await preparationFixture();
    if (!blocked) f.available();
    f.lose(true);
    await userEvent.click(screen.getByRole('button', { name: '출고 준비' }));
    await waitFor(async () =>
      expect((await f.store.pending('scope'))[0]?.status).toBe('uncertain')
    );
    const first = f.writes()[0];
    expect(
      screen.queryByRole('button', { name: '다시 준비' })
    ).not.toBeInTheDocument();
    f.view.unmount();
    f.available();
    f.lose(false);
    const runtime = f.makeRuntime(createOperationStore(f.storeName));
    mount(runtime.runner.request, 'w', runtime);
    await userEvent.click(
      await screen.findByRole('button', { name: '처리 내역 확인' })
    );
    if (blocked) await screen.findByRole('button', { name: '다시 준비' });
    else await screen.findByRole('button', { name: 'B 선택' });
    expect(f.writes()).toHaveLength(2);
    expect(f.writes()[1]).toMatchObject({
      idempotencyKey: first.idempotencyKey,
      bodyJson: first.bodyJson,
    });
  }
);
it('blocks old source scans after a failed current-state read and recovers on a successful GET', async () => {
  const f = await preparationFixture();
  f.available();
  await userEvent.click(screen.getByRole('button', { name: '출고 준비' }));
  await userEvent.click(await screen.findByRole('button', { name: 'B 선택' }));
  f.failReads(true);
  await userEvent.click(screen.getByRole('button', { name: '작업 새로고침' }));
  await screen.findByText(/서버에 문제가/);
  expect(screen.getByLabelText('출고 상품 바코드')).toBeDisabled();
  act(() => emitScan('A'));
  expect(f.writes()).toHaveLength(1);
  f.failReads(false);
  f.changeSource();
  await userEvent.click(screen.getByRole('button', { name: '작업 새로고침' }));
  await screen.findByText(/C · 할당/);
  expect(screen.getByLabelText('출고 상품 바코드')).toBeDisabled();
});

it.each(['failed', 'missing'])(
  'does not expose a preparation success snapshot when current GET is %s',
  async (kind) => {
    const f = await preparationFixture();
    f.available();
    if (kind === 'failed') f.failReads(true);
    else f.missingState();
    await userEvent.click(screen.getByRole('button', { name: '출고 준비' }));
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('출고 상품 바코드')).not.toBeInTheDocument();
    act(() => emitScan('A'));
    expect(f.writes()).toHaveLength(1);
    expect(await f.store.get(f.writes()[0].idempotencyKey!)).toMatchObject({
      status: 'confirmed',
    });
  }
);
it('reconciles a historical preparation snapshot to the current source after response loss', async () => {
  const f = await preparationFixture();
  f.available();
  f.lose(true);
  await userEvent.click(screen.getByRole('button', { name: '출고 준비' }));
  await waitFor(async () =>
    expect((await f.store.pending('scope'))[0]?.status).toBe('uncertain')
  );
  f.changeSource();
  f.lose(false);
  await userEvent.click(
    await screen.findByRole('button', { name: '처리 내역 확인' })
  );
  await screen.findByRole('button', { name: 'C 선택' });
  expect(
    screen.queryByRole('button', { name: 'B 선택' })
  ).not.toBeInTheDocument();
  expect(f.writes()[1].idempotencyKey).toBe(f.writes()[0].idempotencyKey);
});
it('requires fresh physical confirmation when the current source tuple changes', async () => {
  const f = await preparationFixture();
  f.available();
  await userEvent.click(screen.getByRole('button', { name: '출고 준비' }));
  await userEvent.click(
    await screen.findByRole('button', { name: '스캔 생략 확인' })
  );
  await userEvent.type(screen.getByLabelText(/B 실물 수량/), '3');
  await userEvent.type(screen.getByLabelText('스캔 생략 사유'), '확인');
  f.changeSource();
  await userEvent.click(
    screen.getByRole('button', { name: '확인한 수량 출고' })
  );
  await screen.findByText(/남은 수량이 바뀌었어요/);
  expect(f.writes()).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: '스캔 생략 확인' }));
  expect(screen.getByLabelText(/C 실물 수량/)).toHaveValue('');
  expect(
    screen.getByRole('button', { name: '확인한 수량 출고' })
  ).toBeDisabled();
});
it('resolves lost blocked force after permission revocation without resending or reusing physical confirmation', async () => {
  let allowed = true;
  let lost = true;
  const f = await fixture(3, {
    getPermissions: async () => ({ forceDispatch: allowed }),
    forceRequest: async <T,>(o: Parameters<ApiClient['request']>[0]) => {
      if (o.path.endsWith('location-outbound-forces')) {
        // Server persisted preparation_blocked; its response did not reach the client.
        allowed = false;
        throw new TypeError('response lost after blocked commit');
      }
      if (lost) throw new TypeError('resolver response lost');
      return {
        outcome: 'rejected',
        code: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED',
      } as T;
    },
  });
  await submitForce();
  await waitFor(async () =>
    expect((await f.store.pending('scope'))[0]?.status).toBe('uncertain')
  );
  f.view.unmount();
  lost = false;
  const runner = createOperationRunner({
    api: f.api,
    store: f.store,
    getScope: f.runtime.getScope,
    wait: async () => {},
  });
  mount(runner.request, 'w', { ...f.runtime, runner });
  await userEvent.click(
    await screen.findByRole('button', { name: '처리 내역 확인' })
  );
  await waitFor(async () =>
    expect(await f.store.pending('scope')).toHaveLength(0)
  );
  const writes = f.requests.filter((o) => o.method === 'POST');
  expect(
    writes.filter((o) => o.path.endsWith('location-outbound-forces'))
  ).toHaveLength(1);
  expect(new Set(writes.map((o) => o.idempotencyKey)).size).toBe(1);
  expect(new Set(writes.map((o) => o.bodyJson)).size).toBe(1);
  expect(await f.store.get(writes[0].idempotencyKey!)).toMatchObject({
    status: 'rejected',
    errorCode: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED',
  });
  expect(f.picked()).toBe(0);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '스캔 생략 확인' })
  ).not.toBeInTheDocument();
});

it('does not display historical force success as current when the follow-up GET fails', async () => {
  let forceReturned = false;
  const f = await fixture(3, {
    forceRequest: async <T,>() => {
      forceReturned = true;
      return {
        ...state,
        status: 'shipped',
        dispatchAttemptId: 'old-dispatch',
        workItemStatus: 'completed',
        lines: [{ ...state.lines[0], pickedQty: 3, inspectedQty: 3 }],
        sources: [],
      } as T;
    },
  });
  const request = f.api.request;
  vi.spyOn(f.api, 'request').mockImplementation(async (o) => {
    if (forceReturned && o.path.includes('location-outbound-state'))
      throw new Error('GET state → 503');
    return request(o);
  });
  await submitForce();
  await screen.findByText(/서버에 문제가/);
  expect(screen.queryByText('출고완료')).not.toBeInTheDocument();
  expect(screen.getByLabelText('출고 상품 바코드')).toBeDisabled();
});
