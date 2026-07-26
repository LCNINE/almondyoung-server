import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { usePendingPlans, usePutawayPending } from './queries';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function wrapperWith(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

describe('usePendingPlans', () => {
  it('warehouseId 로 GET 경로를 만든다', async () => {
    const request = vi.fn(async (_o: { path: string }) => ({
      totalPendingPlans: 1,
      totalPendingQuantity: 20,
      pendingPlans: [],
    }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    const { result } = renderHook(() => usePendingPlans('w-1'), { wrapper: wrapperWith(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inbound/pending?warehouseId=w-1');
  });

  it('warehouseId 가 없으면 요청하지 않는다', () => {
    const request = vi.fn(async () => ({}));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    renderHook(() => usePendingPlans(null), { wrapper: wrapperWith(client) });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('usePutawayPending', () => {
  it('days 를 쿼리스트링에 싣는다', async () => {
    const request = vi.fn(async (_o: { path: string }) => ({ total: 0, items: [] }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    const { result } = renderHook(() => usePutawayPending('w-1', 1), {
      wrapper: wrapperWith(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe(
      '/inbound/putaway/pending?warehouseId=w-1&days=1'
    );
  });

  it("days 가 'all' 이면 파라미터를 빼고 보낸다", async () => {
    const request = vi.fn(async (_o: { path: string }) => ({ total: 0, items: [] }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    const { result } = renderHook(() => usePutawayPending('w-1', 'all'), {
      wrapper: wrapperWith(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inbound/putaway/pending?warehouseId=w-1');
  });

  it('창고가 없으면 요청하지 않는다', () => {
    const request = vi.fn(async () => ({ total: 0, items: [] }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    renderHook(() => usePutawayPending(null, 1), { wrapper: wrapperWith(client) });
    expect(request).not.toHaveBeenCalled();
  });
});
