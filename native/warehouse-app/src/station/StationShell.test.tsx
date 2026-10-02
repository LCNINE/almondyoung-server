import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { WarehouseProvider } from '../app/warehouse-context';
import { createMemoryPrefs } from '../core/data/devicePrefs';
import { ScanProvider } from '../core/hardware/scan/ScanProvider';
import { useStationActions } from './ActionRegistry';
import type { StationAction } from './actions';
import type { Beep, ToneSink } from './feedback/soundPlayer';
import { useBatchProgress } from './status/batchProgress';
import { StationShell } from './StationShell';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));

const qtyRun = vi.fn();
const PROBE_ACTIONS: StationAction[] = [
  { id: 'probe-qty', key: 'F7', label: '수량', enabled: true, run: () => qtyRun() },
  { id: 'probe-all', key: 'F8', label: '이 상품 전량', enabled: false, run: () => {} },
];

function Probe() {
  useStationActions(PROBE_ACTIONS);
  useBatchProgress({ code: 'B-1002', done: 13, total: 40 });
  return <input aria-label="운송장번호" />;
}

function scan(code: string) {
  act(() => {
    for (const key of [...code, 'Enter']) window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  });
}

function renderShell(initial = '/outbound') {
  const beeps: Beep[] = [];
  const sink: ToneSink = { now: () => 0, beep: (b) => void beeps.push(b) };
  const root = createRootRoute({ component: () => <StationShell sink={sink} /> });
  const page = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => <p>{`page ${path}`}</p> });
  const tree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: '/outbound', component: Probe }),
    page('/outbound/batches'),
    page('/inbound'),
    page('/putaway'),
    page('/returns/putaway'),
    page('/movement'),
    page('/stocktaking'),
    page('/inventory'),
    page('/settings'),
  ]);
  const router = createRouter({ routeTree: tree, history: createMemoryHistory({ initialEntries: [initial] }) });
  render(
    <ScanProvider>
      <WarehouseProvider prefs={createMemoryPrefs({ 'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '부천 창고' }) })}>
        {/* 테스트 전용 라우터라 앱의 Register 타입과 다르다 */}
        <RouterProvider router={router as never} />
      </WarehouseProvider>
    </ScanProvider>
  );
  return { router, beeps };
}

const flash = () => document.querySelector('[data-flash]')?.getAttribute('data-flash') ?? null;

describe('StationShell', () => {
  beforeEach(() => qtyRun.mockReset());

  it('탭 6개를 키와 함께 그리고 지금 탭을 표시한다', async () => {
    renderShell();
    const tabs = await screen.findByRole('navigation', { name: '탭' });
    expect(within(tabs).getAllByRole('link')).toHaveLength(6);
    expect(within(tabs).getByRole('link', { name: /출고 검수/ })).toHaveAttribute('data-active', 'true');
    expect(within(tabs).getByRole('link', { name: /재고 조회/ })).toHaveAttribute('data-active', 'false');
  });

  it('입력칸에 포커스가 있어도 F3 이 입고 탭으로 간다', async () => {
    const { router } = renderShell();
    const input = await screen.findByLabelText('운송장번호');
    input.focus();
    expect(fireEvent.keyDown(input, { key: 'F3' })).toBe(false);
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbound'));
  });

  it('화면 액션: 켜진 것만 기능키 바에(탭 키는 다시 그리지 않는다), F7 은 실행, 꺼진 F8 은 오류', async () => {
    const { beeps } = renderShell();
    const bar = await screen.findByRole('toolbar', { name: '기능키' });
    expect(await within(bar).findByRole('button', { name: /수량/ })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /이 상품 전량/ })).toBeNull();
    expect(within(bar).queryByRole('button', { name: /출고 검수/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'F7' });
    expect(qtyRun).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'F8' });
    expect(flash()).toBe('error');
    expect(beeps.some((b) => b.wave === 'square')).toBe(true);
  });

  it('오류 테두리는 탭을 옮기면 사라진다', async () => {
    const { router } = renderShell();
    await screen.findByRole('button', { name: /수량/ });
    fireEvent.keyDown(window, { key: 'F8' });
    expect(flash()).toBe('error');
    fireEvent.keyDown(window, { key: 'F3' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbound'));
    await waitFor(() => expect(flash()).toBeNull());
  });

  it('기능키 바 버튼을 마우스로 눌러도 같은 액션이 돈다', async () => {
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: /수량/ }));
    expect(qtyRun).toHaveBeenCalledTimes(1);
  });

  it('명령 바코드: %90%07 은 F7 과 같고(명령음), 모르는 명령은 오류, 다음 스캔에서 테두리가 사라진다', async () => {
    const { beeps } = renderShell();
    await screen.findByRole('button', { name: /수량/ });
    scan('%90%07');
    expect(qtyRun).toHaveBeenCalledTimes(1);
    expect(beeps.at(-1)?.frequency).toBe(2637);
    scan('%99%99');
    expect(flash()).toBe('error');
    scan('8801234567890');
    expect(flash()).toBeNull();
  });

  it('확인창이 열려 있으면 명령 바코드도 키처럼 막힌다 — 화면 액션은 안 돌고 오류음', async () => {
    renderShell();
    await screen.findByRole('button', { name: /수량/ });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    try {
      scan('%90%07');
      expect(qtyRun).not.toHaveBeenCalled();
      expect(flash()).toBe('error');
    } finally {
      dialog.remove();
    }
  });

  it('명령 바코드 %90%03 은 입고 탭으로 — 출고 화면의 송장 조회로 새지 않는다', async () => {
    const { router } = renderShell();
    await screen.findByLabelText('운송장번호');
    scan('%90%03');
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbound'));
  });

  it('F4 탭은 하위 탭으로 적치·되돌림 적치·이동을 오간다, F1 에는 하위 탭이 없다', async () => {
    const { router } = renderShell('/movement');
    const sub = await screen.findByRole('navigation', { name: '하위 탭' });
    expect(within(sub).getByRole('link', { name: '이동' })).toHaveAttribute('data-active', 'true');
    fireEvent.click(within(sub).getByRole('link', { name: '되돌림 적치' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/returns/putaway'));
    expect(screen.getByRole('link', { name: /적치·이동/ })).toHaveAttribute('data-active', 'true');
    fireEvent.keyDown(window, { key: 'F1' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/outbound'));
    expect(screen.queryByRole('navigation', { name: '하위 탭' })).toBeNull();
  });

  it('상태바의 배치 진행은 F1 화면이 올리고, 다른 탭으로 가면 사라진다', async () => {
    const { router } = renderShell();
    expect(await screen.findByText('B-1002 13/40')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'F3' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbound'));
    expect(screen.queryByText('B-1002 13/40')).toBeNull();
  });

  it('창고 이름이 설정으로 가는 링크다', async () => {
    renderShell();
    expect(await screen.findByRole('link', { name: '부천 창고' })).toHaveAttribute('href', '/settings');
  });
});
