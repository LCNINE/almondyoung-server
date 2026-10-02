import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '../../app/session-context';
import type { Session } from '../../core/auth/session';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { OperationContext, type WorkRuntime } from '../../core/operations/OperationContext';
import { WorkBoundary } from '../../core/operations/WorkBoundary';
import type { ShipmentByWaybill } from '../../domains/outbound/types';
import { createOutboundServer, createTestRuntime, type FakeBox } from './__fixtures__/outboundServer';
import {
  STATION_FORCE_REASON,
  UNCERTAIN_SCAN_MESSAGE,
  useInspectionBox,
  type InspectionBoxEvents,
} from './useInspectionBox';

const session: Session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
};

const BOX: FakeBox = {
  shipmentId: 's-1',
  trackingNo: '421033881907',
  batchId: 'b-1',
  lines: [
    { id: 'l-1', skuId: 'sku-1', name: '컬러크림', qty: 2, barcode: 'A', locations: [{ code: 'A-03-2', qty: 2 }] },
    { id: 'l-2', skuId: 'sku-2', name: '집게핀', qty: 2, barcode: 'B', locations: [{ code: 'B-11-1', qty: 2 }] },
  ],
};

let box: ReturnType<typeof useInspectionBox>;
function Probe({ found, events }: { found: ShipmentByWaybill; events: InspectionBoxEvents }) {
  box = useInspectionBox(found, events);
  return <p data-testid="progress">{box.progress.map((p) => `${p.shipmentLineId}:${p.pickedQty}/${p.qty}`).join(',')}</p>;
}

function mount(runtime: WorkRuntime, found: ShipmentByWaybill, events: InspectionBoxEvents) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <SessionProvider session={session}>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={runtime.runner}>
          <OperationContext.Provider value={runtime}>
            <WorkBoundary>
              <Probe found={found} events={events} />
            </WorkBoundary>
          </OperationContext.Provider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

const newEvents = () => ({ onAccepted: vi.fn(), onShipped: vi.fn(), onRejected: vi.fn(), onExcess: vi.fn() });
const progress = () => screen.getByTestId('progress').textContent;

async function setup(fake: FakeBox = BOX) {
  const server = createOutboundServer({ boxes: [fake] });
  const runtime = createTestRuntime(server);
  const found = await server.request<ShipmentByWaybill>({ path: `/shipments/by-waybill?trackingNo=${fake.trackingNo}` });
  const events = newEvents();
  const view = mount(runtime, found, events);
  await waitFor(() => expect(box.intakeBlocked).toBe(false));
  const saved = () => runtime.store.draft<Array<{ id: string; data: { barcode: string } }>>(`scope:scan:outbound:${fake.shipmentId}`);
  return { server, runtime, found, events, view, saved };
}

describe('useInspectionBox — 박스 하나의 스캔 큐(스펙 §6.3·§10.1)', () => {
  it('A, A, B 를 찍은 순서와 수량 그대로 보낸다 — 응답이 늦어도', async () => {
    const { server, saved } = await setup();
    const release = server.holdSends();
    act(() => {
      box.accept('A', 1);
      box.accept('A', 1);
      box.accept('B', 1);
    });
    await waitFor(async () => expect(await saved()).toHaveLength(3));
    release();
    await waitFor(async () => expect(await saved()).toHaveLength(0));
    expect(server.scans.map((s) => s.barcode)).toEqual(['A', 'A', 'B']);
    expect(progress()).toBe('l-1:2/2,l-2:1/2');
  });

  it('수량을 실어 보낸다', async () => {
    const { server } = await setup();
    act(() => {
      box.accept('B', 2);
    });
    await waitFor(() => expect(server.scans).toEqual([expect.objectContaining({ barcode: 'B', quantity: 2 })]));
  });

  it('응답을 잃으면 입력을 막고, 다시 맞출 때 같은 키를 쓴다 — 두 번 반영하지 않는다', async () => {
    const { server, runtime, saved } = await setup();
    server.loseResponses(true);
    act(() => {
      box.accept('A', 1);
    });
    await waitFor(async () => expect((await runtime.store.pending('scope'))[0]?.status).toBe('uncertain'));
    await waitFor(() => expect(box.intakeBlocked).toBe(true));
    let accepted = true;
    act(() => {
      accepted = box.accept('B', 1);
    });
    expect(accepted).toBe(false);
    expect((await saved())?.map((e) => e.data.barcode)).toEqual(['A']);
    server.loseResponses(false);
    await act(async () => runtime.runner.retryPending());
    await waitFor(async () => expect(await saved()).toHaveLength(0));
    expect(server.scanCalls).toHaveLength(2);
    expect(new Set(server.scanCalls).size).toBe(1);
    expect(server.scans).toHaveLength(1);
    await waitFor(() => expect(box.intakeBlocked).toBe(false));
  });

  it('다시 열면 저장된 스캔을 원래 키로 다시 보낸다', async () => {
    const { server, runtime, found, events, view, saved } = await setup();
    server.loseResponses(true);
    act(() => {
      box.accept('A', 1);
      box.accept('B', 1);
    });
    await waitFor(async () => expect((await runtime.store.pending('scope'))[0]?.status).toBe('uncertain'));
    await waitFor(async () => expect(await saved()).toHaveLength(2));
    const before = (await saved()) ?? [];
    view.unmount();
    server.loseResponses(false);
    const reopened = createTestRuntime(server, undefined, runtime.store);
    mount(reopened, found, events);
    await act(async () => reopened.runner.retryPending());
    await waitFor(async () => expect(await saved()).toHaveLength(0));
    expect(server.scans.map((s) => s.key)).toEqual(before.map((e) => e.id));
    await waitFor(() => expect(progress()).toBe('l-1:1/2,l-2:1/2'));
  });

  it('스캔 저장에 실패하면 그 스캔을 지키고, 다음 입력을 막는다', async () => {
    const { server, runtime, saved } = await setup();
    const original = runtime.store.draft;
    let diskFull = true;
    vi.spyOn(runtime.store, 'draft').mockImplementation(async (id, update) => {
      if (id.includes(':scan:') && update && diskFull) throw new Error('disk full');
      return original(id, update);
    });
    act(() => {
      box.accept('A', 1);
    });
    await waitFor(() => expect(box.storageError).toBeTruthy());
    let accepted = true;
    act(() => {
      accepted = box.accept('B', 1);
    });
    expect(accepted).toBe(false);
    diskFull = false;
    await act(async () => box.retryHead());
    await waitFor(() => expect(server.scans.map((s) => s.barcode)).toEqual(['A']));
    await waitFor(async () => expect(await saved()).toHaveLength(0));
  });

  it('서버가 거절한 스캔은 반영 없이 알리고, 다음 스캔을 받는다', async () => {
    const { events, saved } = await setup();
    act(() => {
      box.accept('X', 1);
    });
    await waitFor(() => expect(events.onRejected).toHaveBeenCalledWith('이 송장에 없는 상품이에요', 'X'));
    await waitFor(async () => expect(await saved()).toHaveLength(0));
    act(() => {
      box.accept('A', 1);
    });
    await waitFor(() => expect(progress()).toBe('l-1:1/2,l-2:0/2'));
    expect(events.onAccepted).toHaveBeenCalledWith('l-1', 1);
    expect(box.lastScan).toEqual({ barcode: 'A', shipmentLineId: 'l-1' });
  });

  it('저장된 작업을 다 확인하기 전엔 입력을 받지 않는다', async () => {
    const server = createOutboundServer({ boxes: [BOX] });
    const runtime = createTestRuntime(server);
    const found = await server.request<ShipmentByWaybill>({ path: `/shipments/by-waybill?trackingNo=${BOX.trackingNo}` });
    const restore = runtime.runner.restore;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(runtime.runner, 'restore').mockImplementation(async () => {
      await gate;
      await restore();
    });
    mount(runtime, found, newEvents());
    await screen.findByTestId('progress');
    expect(box.intakeBlocked).toBe(true);
    expect(box.accept('A', 1)).toBe(false);
    release();
    await waitFor(() => expect(box.intakeBlocked).toBe(false));
    expect(server.scanCalls).toHaveLength(0);
  });

  it('출고 뒤에 줄 서 있던 스캔은 보내지 않고 알린다', async () => {
    const { server, events, saved } = await setup({ ...BOX, lines: [{ ...BOX.lines[0], qty: 1 }] });
    const release = server.holdSends();
    act(() => {
      box.accept('A', 1);
      box.accept('A', 1);
    });
    await waitFor(async () => expect(await saved()).toHaveLength(2));
    release();
    await waitFor(() => expect(events.onShipped).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(events.onExcess).toHaveBeenCalledTimes(1));
    expect(server.scans).toHaveLength(1);
  });

  it('settle 은 앞 스캔이 다 보내진 뒤에 풀린다', async () => {
    const { server } = await setup();
    const release = server.holdSends();
    act(() => {
      box.accept('A', 1);
    });
    let settled = false;
    const done = box.settle().then(() => {
      settled = true;
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(settled).toBe(false);
    release();
    await act(async () => done);
    expect(server.scans).toHaveLength(1);
  });

  it('settle 은 확인 못 한 스캔이 있으면 기다리지 않고 거절한다', async () => {
    const { server, runtime } = await setup();
    server.loseResponses(true);
    act(() => {
      box.accept('A', 1);
    });
    await waitFor(async () => expect((await runtime.store.pending('scope'))[0]?.status).toBe('uncertain'));
    await waitFor(() => expect(box.intakeBlocked).toBe(true));
    await expect(box.settle()).rejects.toThrow(UNCERTAIN_SCAN_MESSAGE);
  });

  it('기다리던 settle 도 그 사이 스캔이 불확실해지면 거절된다 — 매달리지 않는다', async () => {
    const { server } = await setup();
    const release = server.holdSends();
    server.loseResponses(true);
    let settling!: Promise<void>;
    act(() => {
      box.accept('A', 1);
      settling = box.settle();
    });
    release();
    await expect(settling).rejects.toThrow(UNCERTAIN_SCAN_MESSAGE);
  });

  it('다른 박스의 확인 못 한 스캔이 남아 있으면 입력을 막는다', async () => {
    const server = createOutboundServer({ boxes: [BOX] });
    const runtime = createTestRuntime(server);
    await runtime.store.begin({
      id: 'foreign',
      scope: 'scope',
      resource: '/shipments/other',
      path: '/shipments/other/simple-outbound-scans',
      method: 'POST',
      createdAt: Date.now(),
      bodyJson: JSON.stringify({ barcode: 'A', quantity: 1 }),
    });
    await runtime.store.finish('foreign', 'uncertain');
    const found = await server.request<ShipmentByWaybill>({ path: `/shipments/by-waybill?trackingNo=${BOX.trackingNo}` });
    mount(runtime, found, newEvents());
    await screen.findByTestId('progress');
    await act(async () => runtime.runner.restore());
    await waitFor(() => expect(box.intakeBlocked).toBe(true));
    expect(box.accept('A', 1)).toBe(false);
  });

  it('강제출고는 고정 사유로 보내고, 출고되면 알린다', async () => {
    const { server, events } = await setup();
    await act(async () => box.forceOut());
    expect(server.forces).toEqual([{ shipmentId: 's-1', reason: STATION_FORCE_REASON }]);
    expect(events.onShipped).toHaveBeenCalledTimes(1);
  });
});
