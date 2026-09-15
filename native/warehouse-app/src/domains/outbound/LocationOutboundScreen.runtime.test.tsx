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
  return render(
    <SessionProvider session={session}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
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
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function fixture(total = 3) {
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
    applied,
    picked: () => picked,
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
    await act(async () => f.runner.restore());
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
  await userEvent.click(screen.getByRole('button', { name: '처리 내역 확인' }));
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
