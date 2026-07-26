import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { SessionProvider } from './session-context';
import { WarehouseProvider } from './warehouse-context';
import { createMemoryPrefs } from '../core/data/devicePrefs';
import { ApiClientProvider } from '../core/data/ApiClientProvider';
import type { ApiClient } from '../core/data/httpClient';
import { ScanProvider } from '../core/hardware/scan/ScanProvider';
import { createAppRouter } from './router';
import type { Session } from '../core/auth/session';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'android' }));

function stub(): Session {
  return {
    bootstrap: async () => {},
    isAuthenticated: () => true,
    getAccessToken: async () => 'tok',
    login: async () => {},
    logout: async () => {},
    subscribe: () => () => {},
  } satisfies Session;
}

describe('handheld hub navigation', () => {
  it('shows handheld tiles and drills into a placeholder workflow', async () => {
    const session = stub();
    const user = userEvent.setup();
    // 실사 화면(SessionListScreen)이 useApiClient()/useQuery()를 부르므로
    // (창고 미설정이면 WarehousePicker 가 useWarehouses()도 부른다) 두 프로바이더가 필요하다.
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path === '/inventory/warehouses') return [];
        return { data: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>
            <WarehouseProvider prefs={createMemoryPrefs()}>
              <ScanProvider>
                <RouterProvider router={createAppRouter(session)} />
              </ScanProvider>
            </WarehouseProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );

    expect(await screen.findByRole('link', { name: /실사/ })).toBeInTheDocument();
    await act(async () => {
      await user.click(screen.getByRole('link', { name: /실사/ }));
    });
    expect(await screen.findByRole('heading', { name: '실사' })).toBeInTheDocument();
    // SessionListScreen 은 ScreenHeader 를 쓴다 — "← 홈" 텍스트 링크가 아니라
    // aria-label="뒤로" 아이콘 링크로 허브(/)에 돌아간다.
    await act(async () => {
      await user.click(screen.getByRole('link', { name: '뒤로' }));
    });
    expect(await screen.findByRole('link', { name: /재고조회/ })).toBeInTheDocument();
  });

  it('허브의 적치 타일이 적치 대기 큐 화면으로 간다', async () => {
    const session = stub();
    const user = userEvent.setup();
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path === '/inventory/warehouses') return [];
        return { data: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>
            <WarehouseProvider prefs={createMemoryPrefs()}>
              <ScanProvider>
                <RouterProvider router={createAppRouter(session)} />
              </ScanProvider>
            </WarehouseProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );

    const tile = await screen.findByRole('link', { name: /적치/ });
    await act(async () => {
      await user.click(tile);
    });
    // 이 테스트는 창고 미설정 상태로 렌더한다 — 큐 화면은 실제 화면이지만
    // 창고 선택을 먼저 요구하는 카드를 보여준다(플레이스홀더가 아니다).
    expect(await screen.findByRole('heading', { name: '적치' })).toBeInTheDocument();
    expect(screen.getByText('창고를 먼저 선택해 주세요.')).toBeInTheDocument();
  });

  it('입고 타일이 예정 목록으로 간다 (플레이스홀더가 아니다)', async () => {
    const session = stub();
    const user = userEvent.setup();
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path === '/inventory/warehouses') return [];
        if (opts.path.startsWith('/inbound/pending')) {
          return { totalPendingPlans: 0, totalPendingQuantity: 0, pendingPlans: [] };
        }
        return { data: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>
            <WarehouseProvider
              prefs={createMemoryPrefs({
                'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
              })}
            >
              <ScanProvider>
                <RouterProvider router={createAppRouter(session)} />
              </ScanProvider>
            </WarehouseProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );

    const tile = await screen.findByRole('link', { name: /입고/ });
    await act(async () => {
      await user.click(tile);
    });
    // 플레이스홀더의 "Phase 2에서 구현됩니다" 대신 실제 화면이 떠야 한다
    expect(await screen.findByRole('link', { name: '간편입고' })).toBeInTheDocument();
  });
});
