/* oxlint-disable react/only-export-components -- 테스트 전용 하네스: 렌더 함수·상자 데이터·키 보조 함수를 한 파일에서 낸다 */
import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { expect, vi } from 'vitest';
import { SessionProvider } from '../../../app/session-context';
import { WarehouseProvider } from '../../../app/warehouse-context';
import type { Session } from '../../../core/auth/session';
import { ApiClientProvider } from '../../../core/data/ApiClientProvider';
import { createMemoryPrefs, type DevicePrefs } from '../../../core/data/devicePrefs';
import { LABEL_PRINTER_KEY, type PrintRaw } from '../../../core/hardware/print/labelPrinter';
import { ScanProvider } from '../../../core/hardware/scan/ScanProvider';
import { OperationContext, type WorkPermissions, type WorkRuntime } from '../../../core/operations/OperationContext';
import { WorkBoundary } from '../../../core/operations/WorkBoundary';
import type { OutboundBatchSummary } from '../../../domains/outbound/types';
import type { Beep, ToneSink } from '../../feedback/soundPlayer';
import { StationShell } from '../../StationShell';
import { InspectionScreen } from '../InspectionScreen';
import { WAREHOUSE_ID, createOutboundServer, createTestRuntime, type FakeBox } from './outboundServer';

const session: Session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
};

/** 목업 ②의 박스 — 위치 순서가 줄 순서와 다르다(표가 송장 순서로 정렬하는지 본다) */
export const BOX1: FakeBox = {
  shipmentId: 's-1',
  trackingNo: '421033881907',
  batchId: 'b-1',
  recipient: '김*영',
  deliveryNote: '문 앞에 놓아주세요',
  lines: [
    { id: 'l-2', skuId: 'sku-2', name: '헤어클립 집게핀', qty: 3, barcode: '8801002', locations: [{ code: 'B-11-1', qty: 3 }] },
    { id: 'l-1', skuId: 'sku-1', name: '컬러크림 6N', qty: 1, barcode: '8801001', locations: [{ code: 'A-03-2', qty: 1 }] },
  ],
};

export const BOX2: FakeBox = {
  shipmentId: 's-2',
  trackingNo: '421033881915',
  batchId: 'b-1',
  recipient: '이*진',
  lines: [{ id: 'l-3', skuId: 'sku-3', name: '샴푸 퍼퓸', qty: 1, barcode: '8801003', locations: [{ code: 'D-07-3', qty: 1 }] }],
};

export function stationPrefs(extra: Record<string, string> = {}, printer = true): DevicePrefs {
  return createMemoryPrefs({
    'almondwms.warehouse': JSON.stringify({ id: WAREHOUSE_ID, name: '부천 창고' }),
    ...(printer ? { [LABEL_PRINTER_KEY]: 'spooler://XP-DT108B' } : {}),
    ...extra,
  });
}

/** 스테이션 셸(키·명령·소리·상태바) 안에 화면 하나를 그린다 */
export function renderStation(Screen: () => ReactNode, opts: { runtime: WorkRuntime; prefs: DevicePrefs; path?: string }) {
  const beeps: Beep[] = [];
  const sink: ToneSink = { now: () => 0, beep: (b) => void beeps.push(b) };
  const path = opts.path ?? '/outbound';
  const root = createRootRoute({ component: () => <StationShell sink={sink} /> });
  const routes = ['/outbound', '/outbound/batches', '/inbound', '/settings'].map((p) =>
    createRoute({
      getParentRoute: () => root,
      path: p,
      component: p === path ? Screen : () => <p>{`page ${p}`}</p>,
    })
  );
  const router = createRouter({ routeTree: root.addChildren(routes), history: createMemoryHistory({ initialEntries: [path] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <SessionProvider session={session}>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={opts.runtime.runner}>
          <OperationContext.Provider value={opts.runtime}>
            <WarehouseProvider prefs={opts.prefs}>
              <ScanProvider>
                <WorkBoundary>
                  {/* 테스트 전용 라우터라 앱의 Register 타입과 다르다 */}
                  <RouterProvider router={router as never} />
                </WorkBoundary>
              </ScanProvider>
            </WarehouseProvider>
          </OperationContext.Provider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return { ...view, router, beeps, queryClient };
}

/** F1 출고 검수를 가짜 core 위에 그리고 «송장 바코드» 가 뜰 때까지 기다린다. 배치 목록은 그리기 전에 넣어야 첫 조회에 잡힌다 */
export async function setupInspection(
  opts: {
    boxes?: FakeBox[];
    prefs?: DevicePrefs;
    permissions?: WorkPermissions;
    print?: PrintRaw;
    picking?: OutboundBatchSummary[];
    refills?: unknown[] | 'fail';
  } = {}
) {
  const server = createOutboundServer({ boxes: opts.boxes ?? [BOX1, BOX2] });
  server.config.batches.picking = opts.picking ?? [];
  if (opts.refills === 'fail') server.config.refillsFail = true;
  else server.config.refills = opts.refills ?? [];
  const runtime = createTestRuntime(server, opts.permissions);
  const print = opts.print ?? vi.fn<PrintRaw>(async () => {});
  const prefs = opts.prefs ?? stationPrefs();
  const view = renderStation(() => <InspectionScreen prefs={prefs} print={print} />, { runtime, prefs });
  await screen.findByText('송장 바코드');
  return { server, runtime, print, prefs, ...view };
}

/** 스캐너처럼 한 번에 몰아 보낸다(묶음 + Enter) */
export function scan(code: string) {
  act(() => {
    for (const key of [...code, 'Enter']) window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  });
}

export function press(key: string) {
  act(() => {
    fireEvent.keyDown(window, { key });
  });
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 사람처럼 친다 — 키마다 묶음 간격(50ms)보다 오래 쉰다. 숫자는 그 뒤에야 사람 키로 확정된다 */
export async function typeHuman(keys: string[]) {
  for (const key of keys) {
    press(key);
    await act(async () => {
      await sleep(70);
    });
  }
}

/** 송장을 찍고 상품을 받을 수 있을 때까지 기다린다 */
export async function openBox(trackingNo: string) {
  scan(trackingNo);
  await waitFor(() => expect(document.querySelector('[data-intake="open"]')).not.toBeNull());
  // 칸이 열린 커밋의 effect(기능키 등록)까지 돈 뒤에 돌려준다 — 바로 누른 F7 이 앞 렌더의 «꺼짐» 으로 판정되지 않게
  await act(async () => {});
}

export const flash = () => document.querySelector('[data-flash]')?.getAttribute('data-flash') ?? null;
