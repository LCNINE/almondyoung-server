import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter, createMemoryHistory } from '@tanstack/react-router';
import { SessionProvider } from './session-context';
import { WarehouseProvider } from './warehouse-context';
import { createMemoryPrefs, type DevicePrefs } from '../core/data/devicePrefs';
import { ApiClientProvider } from '../core/data/ApiClientProvider';
import type { ApiClient } from '../core/data/httpClient';
import { ScanProvider } from '../core/hardware/scan/ScanProvider';
import { routeTree } from './routeTree';
import type { Session } from '../core/auth/session';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));

function makeStub() {
  let authed = false;
  const ls = new Set<() => void>();
  const session: Session = {
    bootstrap: async () => {},
    isAuthenticated: () => authed,
    getAccessToken: async () => 'tok',
    login: async () => {
      authed = true;
      ls.forEach((l) => l());
    },
    logout: async () => {
      authed = false;
      ls.forEach((l) => l());
    },
    subscribe: (fn: () => void) => {
      ls.add(fn);
      return () => {
        ls.delete(fn);
      };
    },
  } satisfies Session;
  return {
    session,
    setAuthed: (v: boolean) => {
      authed = v;
      ls.forEach((l) => l());
    },
  };
}

// 창고 미설정으로 렌더한다 — 각 화면은 창고 목록(빈 배열)만 부르고 창고 선택을 요구한다.
const client: ApiClient = {
  request: (async (opts: { path: string }) =>
    opts.path === '/inventory/warehouses' ? [] : { data: [], total: 0 }) as unknown as ApiClient['request'],
};

function renderAppRouter(
  initialEntries: string[],
  session: Session,
  prefs: DevicePrefs = createMemoryPrefs(),
  api: ApiClient = client
) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries }),
    context: { session },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={api}>
          <WarehouseProvider prefs={prefs}>
            <ScanProvider>
              <RouterProvider router={router} />
            </ScanProvider>
          </WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return router;
}

const renderApp = (session: Session) => renderAppRouter(['/'], session);

describe('router guard integration (스테이션)', () => {
  it('sends an unauthenticated user to the login screen', async () => {
    const { session } = makeStub();
    renderApp(session);
    expect(await screen.findByRole('button', { name: /^login$/i })).toBeInTheDocument();
  });

  it('로그인 뒤 셸이 창 전체를 쓰고 첫 탭은 출고 검수다', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    const router = renderApp(session);
    expect(await screen.findByRole('navigation', { name: '탭' })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/outbound'));
    expect(screen.queryByText('Almond WMS')).toBeNull();
  });

  it('redirects to login when the session logs out', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    renderApp(session);
    expect(await screen.findByRole('navigation', { name: '탭' })).toBeInTheDocument();
    await act(async () => {
      setAuthed(false);
    });
    expect(await screen.findByRole('button', { name: /^login$/i })).toBeInTheDocument();
  });

  it('keeps diagnostics off the ordinary work shell', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    renderApp(session);
    expect(await screen.findByRole('navigation', { name: '탭' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /진단/ })).not.toBeInTheDocument();
  });

  it('/picking 과 /packing 은 /outbound 로 보낸다', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    const router = renderAppRouter(['/picking'], session);
    await waitFor(() => expect(router.state.location.pathname).toBe('/outbound'));
  });

  it('F5 는 웹뷰 새로고침 대신 실사 탭이다', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    const router = renderApp(session);
    await screen.findByRole('navigation', { name: '탭' });
    expect(fireEvent.keyDown(window, { key: 'F5' })).toBe(false);
    await waitFor(() => expect(router.state.location.pathname).toBe('/stocktaking'));
  });
});

it('예전 스테이션 홈 타일의 작업에 탭·하위 탭으로 모두 닿는다(U3)', async () => {
  const { session, setAuthed } = makeStub();
  setAuthed(true);
  const router = renderApp(session);
  await screen.findByRole('navigation', { name: '탭' });
  // 입고내역·간편입고는 입고 화면 안의 링크로 간다 — ExpectedArrivalListScreen 테스트가 그 링크를 지킨다
  const cases: Array<[string, string | null, string]> = [
    ['F6', null, '/inventory'],
    ['F3', null, '/inbound'],
    ['F4', '적치', '/putaway'],
    ['F4', '되돌림 적치', '/returns/putaway'],
    ['F4', '이동', '/movement'],
    ['F5', null, '/stocktaking'],
    ['F1', null, '/outbound'],
    ['F2', null, '/outbound/batches'],
  ];
  for (const [key, section, path] of cases) {
    fireEvent.keyDown(window, { key });
    if (section) {
      const sub = await screen.findByRole('navigation', { name: '하위 탭' });
      fireEvent.click(within(sub).getByRole('link', { name: section }));
    }
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
  }
  fireEvent.click(screen.getByRole('link', { name: '창고 미설정' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
});

it('스테이션 설정에서 명령 바코드 시트를 연다', async () => {
  const { session, setAuthed } = makeStub();
  setAuthed(true);
  const router = renderAppRouter(['/settings'], session);
  fireEvent.click(await screen.findByRole('link', { name: '명령 바코드 시트' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/station/command-sheet'));
  expect(await screen.findByRole('button', { name: '인쇄' })).toBeInTheDocument();
});

it('스테이션의 F1 은 출고 검수, F2 는 배치 현황 화면이다', async () => {
  const { session, setAuthed } = makeStub();
  setAuthed(true);
  const prefs = createMemoryPrefs({ 'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '부천 창고' }) });
  const stationClient: ApiClient = {
    request: (async (opts: { path: string }) =>
      opts.path.startsWith('/outbound-batches') || opts.path.startsWith('/outbound-refills')
        ? []
        : { data: [], total: 0 }) as unknown as ApiClient['request'],
  };
  const router = renderAppRouter(['/outbound'], session, prefs, stationClient);
  expect(await screen.findByText('송장 바코드')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'F2' });
  await waitFor(() => expect(router.state.location.pathname).toBe('/outbound/batches'));
  expect(await screen.findByText('진행 중인 배치가 없어요.')).toBeInTheDocument();
});
